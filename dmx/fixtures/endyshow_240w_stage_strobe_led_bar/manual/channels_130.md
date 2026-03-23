# 130 Channels Mode
# Confirmed by Sina against the manual. Found typo in manual, CH128 should be W16 not AW16.
# ⚠ RGB pixel order corrected: actual order is R,G,B (manual printed R,B,G for pixel 1 — verified on fixture).

| Channel | Value   | Function              |
|---------|---------|-----------------------|
| CH1     | 000-255 | R1 (0-100%)           |
| CH2     | 000-255 | G1 (0-100%)           |
| CH3     | 000-255 | B1 (0-100%)           |
| …       | …       | *(CH4–CH93: R/G/B for pixels 2–31, same R,G,B pattern)* |
| CH94    | 000-255 | R32 (0-100%)          |
| CH95    | 000-255 | G32 (0-100%)          |
| CH96    | 000-255 | B32 (0-100%)          |
| CH97    | 000-255 | A1 (0-100%)           |
| …       | …       | *(CH98–CH111: A2–A15, same pattern)* |
| CH112   | 000-255 | A16 (0-100%)          |
| CH113   | 000-255 | W1                    |
| …       | …       | *(CH114–CH127: W2–W15, same pattern)* |
| CH128   | 000-255 | W16 (0-100%)          |
| CH129   | 000-009 | No function           |
| CH129   | 010-255 | RGB Strobe (slow-fast)|
| CH130   | 000-009 | No function           |
| CH130   | 010-255 | ACW Strobe (slow-fast)|
