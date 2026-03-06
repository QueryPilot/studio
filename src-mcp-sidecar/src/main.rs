//! querypilot agent CLI — thin socket forwarder.
//!
//! Usage:
//!   querypilot agent <capability-id>
//!   (reads JSON request envelope from stdin, writes JSON response to stdout)

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

const SOCKET_TIMEOUT_SECS: u64 = 30;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StdinRequest {
    version: String,
    request_id: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketRequest {
    version: String,
    request_id: String,
    capability: String,
    params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    ok: bool,
    request_id: String,
    capability: String,
    error: ErrorDetail,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorDetail {
    code: String,
    message: String,
}

fn socket_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".querypilot")
        .join("agent.sock")
}

fn write_error(request_id: &str, capability: &str, code: &str, message: &str) {
    let resp = ErrorResponse {
        ok: false,
        request_id: request_id.to_string(),
        capability: capability.to_string(),
        error: ErrorDetail {
            code: code.to_string(),
            message: message.to_string(),
        },
    };
    let _ = serde_json::to_writer(std::io::stdout(), &resp);
    let _ = std::io::stdout().write_all(b"\n");
    let _ = std::io::stdout().flush();
}

fn main() {
    let mut args = std::env::args().skip(1);
    let subcommand = args.next();
    let capability = args.next();

    if subcommand.as_deref() != Some("agent") || capability.is_none() {
        eprintln!("Usage: querypilot agent <capability-id>");
        std::process::exit(2);
    }

    let capability = capability.unwrap();

    // Read stdin
    let mut stdin_buf = String::new();
    if std::io::stdin().read_to_string(&mut stdin_buf).is_err() {
        write_error("unknown", &capability, "read_stdin_failed", "Failed to read stdin");
        std::process::exit(1);
    }

    // Parse stdin envelope
    let stdin_request: StdinRequest = match serde_json::from_str(&stdin_buf) {
        Ok(req) => req,
        Err(e) => {
            write_error(
                "unknown",
                &capability,
                "invalid_request",
                &format!("Invalid JSON: {}", e),
            );
            std::process::exit(1);
        }
    };

    // Build socket request (inject capability from CLI arg)
    let socket_request = SocketRequest {
        version: stdin_request.version,
        request_id: stdin_request.request_id.clone(),
        capability: capability.clone(),
        params: stdin_request.params,
    };

    let request_json = match serde_json::to_string(&socket_request) {
        Ok(json) => json,
        Err(e) => {
            write_error(
                &stdin_request.request_id,
                &capability,
                "serialize_failed",
                &format!("{}", e),
            );
            std::process::exit(1);
        }
    };

    // Connect to socket
    let path = socket_path();
    let mut stream = match UnixStream::connect(&path) {
        Ok(s) => s,
        Err(e) => {
            write_error(
                &stdin_request.request_id,
                &capability,
                "connection_failed",
                &format!(
                    "Cannot connect to Query Pilot ({}): {}. Is the app running?",
                    path.display(),
                    e
                ),
            );
            std::process::exit(1);
        }
    };

    // Set timeouts
    let timeout = Duration::from_secs(SOCKET_TIMEOUT_SECS);
    let _ = stream.set_write_timeout(Some(timeout));
    let _ = stream.set_read_timeout(Some(timeout));

    // Send request
    if stream.write_all(request_json.as_bytes()).is_err()
        || stream.write_all(b"\n").is_err()
        || stream.flush().is_err()
    {
        write_error(
            &stdin_request.request_id,
            &capability,
            "write_failed",
            "Failed to write to socket",
        );
        std::process::exit(1);
    }

    // Shut down write half so server knows we're done
    let _ = stream.shutdown(std::net::Shutdown::Write);

    // Read response
    let mut response_buf = String::new();
    if stream.read_to_string(&mut response_buf).is_err() {
        write_error(
            &stdin_request.request_id,
            &capability,
            "read_failed",
            "Failed to read from socket",
        );
        std::process::exit(1);
    }

    // Forward response to stdout as-is
    let _ = std::io::stdout().write_all(response_buf.as_bytes());
    if !response_buf.ends_with('\n') {
        let _ = std::io::stdout().write_all(b"\n");
    }
    let _ = std::io::stdout().flush();
}
