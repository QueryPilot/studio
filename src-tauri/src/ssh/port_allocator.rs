use std::io;
use std::net::TcpListener;

/// Reserve a free ephemeral port on `127.0.0.1`.
///
/// The caller is expected to immediately bind the returned port using
/// the SSH tunnel. The listener is dropped before returning so the
/// port can be re-bound by the tunnel setup.
pub fn allocate_local_port() -> io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Check whether a local port currently accepts TCP connections.
pub async fn is_port_listening(port: u16) -> bool {
    use tokio::net::TcpStream;

    TcpStream::connect(("127.0.0.1", port)).await.is_ok()
}
