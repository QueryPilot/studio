use serde::Serialize;

/// Text span with byte offsets.
#[derive(Serialize, serde::Deserialize, Clone, Debug, Copy, PartialEq)]
pub struct TextSpan {
    pub start: usize,
    pub end: usize,
}

impl TextSpan {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }

    pub fn empty() -> Self {
        Self { start: 0, end: 0 }
    }
}
