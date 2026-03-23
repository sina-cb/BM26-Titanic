# 135 Channels Mode
# Confirmed by Sina against the manual. Found typo in manual, CH128 should be W16 not AW16.
# ⚠ RGB pixel order corrected: actual order is R,G,B (manual printed R,B,G for pixel 1 — verified on fixture).

| Channel | Value   | Function                                             | Notes              |
|---------|---------|------------------------------------------------------|--------------------|
| CH1     | 000-255 | R1 (0-100%)                                          |                    |
| CH2     | 000-255 | G1 (0-100%)                                          |                    |
| CH3     | 000-255 | B1 (0-100%)                                          |                    |
| …       | …       | *(CH4–CH93: R/G/B for pixels 2–31, same R,G,B pattern)* |               |
| CH94    | 000-255 | R32 (0-100%)                                         |                    |
| CH95    | 000-255 | G32 (0-100%)                                         |                    |
| CH96    | 000-255 | B32 (0-100%)                                         |                    |
| CH97    | 000-255 | A1 (0-100%)                                          |                    |
| …       | …       | *(CH98–CH111: A2–A15, same pattern)*                |                    |
| CH112   | 000-255 | A16 (0-100%)                                         |                    |
| CH113   | 000-255 | W1                                                   |                    |
| …       | …       | *(CH114–CH127: W2–W15, same pattern)*               |                    |
| CH128   | 000-255 | W16 (0-100%)                                        |                    |
| CH129   | 000-009 | No function                                          |                    |
| CH129   | 010-255 | RGB Strobe (slow-fast)                               |                    |
| CH130   | 000-009 | No function                                          |                    |
| CH130   | 010-255 | ACW Strobe (slow-fast)                               |                    |
| CH131   | 000-002 | No function                                          | RGB Effect Channel |
| CH131   | 003-005 | Pattern 1 (CH1~3 can control the color)              | RGB Effect Channel |
| CH131   | 006-008 | Pattern 2 (CH1~3 can control the color)              | RGB Effect Channel |
| CH131   | …       | *(…)*                                                | RGB Effect Channel |
| CH131   | 108-110 | Pattern 36 (CH1~3 can control the color)             | RGB Effect Channel |
| CH131   | 111-113 | Pattern 37 (built-in pattern color)                  | RGB Effect Channel |
| CH131   | 114-116 | Pattern 38 (built-in pattern color)                  | RGB Effect Channel |
| CH131   | …       | *(…)*                                                | RGB Effect Channel |
| CH131   | 204-206 | Pattern 68 (built-in pattern color)                  | RGB Effect Channel |
| CH131   | 207-209 | Auto running 1~68 effect                             | RGB Effect Channel |
| CH131   | 210-212 | Sound 1 (CH1~3 can control the color)                | RGB Effect Channel |
| CH131   | 213-215 | Sound 2 (CH1~3 can control the color)                | RGB Effect Channel |
| CH131   | 216-255 | Sound 3 (CH1~3 can control the color)                | RGB Effect Channel |
| CH132   | 000-255 | RGB Speed (Slow-fast)                                |                    |
| CH133   | 000-255 | Effect background color selection *(see RGB Background Color table)* | |
| CH134   | 000-005 | No function                                          | ACW Effect Channel |
| CH134   | 006-011 | Pattern 1 (CH97/113 can control the color)           | ACW Effect Channel |
| CH134   | 012-017 | Pattern 2 (CH97/113 can control the color)           | ACW Effect Channel |
| CH134   | …       | *(…)*                                                | ACW Effect Channel |
| CH134   | 216-221 | Pattern 36 (CH97/113 can control the color)          | ACW Effect Channel |
| CH134   | 222-225 | Auto running 1~36 effect                             | ACW Effect Channel |
| CH135   | 000-255 | ACW Speed (Slow-fast)                                |                    |
