# 82 Channels Mode
# Confirmed by Sina against the manual. Found typo in manual, CH80 should be W16 not AW16.
# ⚠ RGB pixel order corrected: actual order is R,G,B (manual printed R,B,G for pixel 1 — verified on fixture).

| Channel | Value   | Function              |
|---------|---------|-----------------------|
| CH1     | 000-255 | R1 (0-100%)           |
| CH2     | 000-255 | G1 (0-100%)           |
| CH3     | 000-255 | B1 (0-100%)           |
| …       | …       | *(CH4–CH45: R/G/B for pixels 2–15, same R,G,B pattern)* |
| CH46    | 000-255 | R16 (0-100%)          |
| CH47    | 000-255 | G16 (0-100%)          |
| CH48    | 000-255 | B16 (0-100%)          |
| CH49    | 000-255 | A1 (0-100%)           |
| …       | …       | *(CH50–CH63: A2–A15, same pattern)* |
| CH64    | 000-255 | A16 (0-100%)          |
| CH65    | 000-255 | W1                    |
| …       | …       | *(CH66–CH79: W2–W15, same pattern)* |
| CH80    | 000-255 | W16 (0-100%)          |
| CH81    | 000-009 | No function           |
| CH81    | 010-255 | RGB Strobe (slow-fast)|
| CH82    | 000-009 | No function           |
| CH82    | 010-255 | ACW Strobe (slow-fast)|
