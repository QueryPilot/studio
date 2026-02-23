//! ACP (Agent Client Protocol) module for AI agent integration
//!
//! This module provides integration with AI coding agents via the standardized
//! Agent Client Protocol (ACP). It supports auto-discovery of installed agents
//! (Claude Code, OpenCode, Codex) and manages their lifecycle as subprocesses.
//! Also supports Ollama for local LLM inference via HTTP API.

pub mod commands;
pub mod discovery;
pub mod llm_home;
pub mod manager;
pub mod ollama;
