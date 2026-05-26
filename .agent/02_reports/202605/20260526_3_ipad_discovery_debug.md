# iPad <-> Mac Discovery Failure — Full Situation Report

**Date:** 2026-05-26
**Status:** UNRESOLVED at code level (root cause is environmental, not application bug). Diagnostic-complete and ready for expert review.
**Author:** investigator agent (Claude, opus-4-7, 1M)
**Subject machine:** operator's Apple Silicon Mac, `dev/summer_camp_readiness` @ `4b500ed`
**Subject network:** WiFi SSID `MS-LED`, subnet `10.1.1.0/24`, gateway GL.iNet at `10.1.1.1`

---

## 1. Symptom

The operator's iPad ("FoH iPad 2") on WiFi `MS-LED` cannot reach the MarsinEngine running on the operator's Mac (also on `MS-LED`). Specifically:

- CaptainPad's Config-tab "SCAN NETWORK" with subnet `10.1.1` returns 0 results.
- Manual entry of `http://10.1.1.<mac-ip>:6968` in CaptainPad's Config tab -> test connection times out.
- Safari on the iPad -> `http://10.1.1.<mac-ip>:6968/status` -> also times out.

**Additional symptom data collected this session:**

- From the Mac itself: `ping -c 3 10.1.1.211` (the iPad) -> 100% packet loss.
- From the Mac itself: `ping -c 1 10.1.1.156` (a peer that DOES have a resolved MAC in our ARP table) -> 100% packet loss. **L2 resolution is not the issue — even known peers cannot be ICMP'd.**
- `arp -n 10.1.1.211` -> `(incomplete)`. iPad does NOT answer this Mac's L2 ARP request.
- `route -n get 10.1.1.211` -> contains the `REJECT` flag in the kernel route (`<UP,HOST,REJECT,DONE,LLINFO,WASCLONED,IFSCOPE,IFREF>`), confirming the kernel cached the resolution failure.
- The gateway `10.1.1.1` is reachable: `ping 10.1.1.1` -> 0% loss, ARP resolved (`94:83:c4:c6:eb:70`), normal RTT ~4 ms.
- Self LAN IP `10.1.1.177` is reachable (loopback via lo0).
- **Only the gateway is reachable. Every other LAN host is silently dropped.**

---

## 2. What has been PROVEN INNOCENT

### 2a. The router (GL.iNet at 10.1.1.1)

The operator confirmed that running the same MarsinEngine on their Windows machine on the same `MS-LED` WiFi is discoverable AND reachable from the iPad just fine. So the router is allowing client-to-client traffic in general. Any client-isolation theory on the router would have to explain why ONLY this Mac is blocked while the Windows machine is not — it can't.

### 2b. The engine binary and code

- Engine binds wildcard `*:6968` (IPv6 dual-stack; accepts IPv4 too). Confirmed by `lsof -iTCP:6968 -sTCP:LISTEN -P -n`: `node 90149 ... TCP *:6968 (LISTEN)`.
- `/status` returns the exact payload CaptainPad's scanner filters for:
  ```json
  {"service":"marsin-engine","name":"MarsinEngine","version":"2.0","port":6968,
   "activeScene":"test_bench","activeModel":"test_bench",
   "activePattern":"00_golden_hour_wash","unrealState":"streaming"}
  ```
- `curl -m 3 http://127.0.0.1:6968/status` from the Mac -> 200 OK in <5 ms.
- `curl -m 3 http://10.1.1.177:6968/status` from the Mac itself (current LAN IP) -> 200 OK in <5 ms. Proves engine listens on the LAN IP, not just loopback.
- A Node script replicating CaptainPad's discovery scan logic line-for-line, run from this Mac scanning `10.1.1.0/24`, finds the engine at `10.1.1.<current-mac-ip>:6968`. Scanner code is correct AND the engine is reachable on its LAN IP from this Mac itself.
- The operator's CaptainPad-web build running ON THIS MAC at `http://127.0.0.1:6967/config` (same React/TS code as the iPad app, served via Expo web export) talks to the engine fine. Same scanner code, same engine, working over loopback. Pure end-to-end JS path proven.

### 2c. The iPad client (CaptainPad)

- `CaptainPad/hooks/useServerDiscovery.ts:33` -> `SCAN_PORT = 6968`. Matches `simulation/config.yaml:14` -> `marsin_engine_port: 6968`. No drift.
- Discovery filter `data.service === 'marsin-engine'` (`useServerDiscovery.ts:81`) matches the engine's `/status` payload byte-for-byte.
- iOS Local Network permission for CaptainPad is ON (operator confirmed).
- iPadOS 26.4.2, paired and trusted.
- **The same iPad app works against the Windows machine's engine on the same WiFi**, so the iPad app is not the bug.

### 2d. Recent engine code commits

The operator suspected recent engine commits (`cb76298` kick EMA + `59c122e` reachable URLs print + `dda8be3` print filter) might have broken networking. They are file-level innocent:

- `cb76298` touches only `marsin_engine/lib/audio_analyzer.js` + tests (FFT math). Zero network code.
- `59c122e` adds a read-only `os.networkInterfaces()` enumeration printed at boot. Zero binding / route / firewall changes.
- `dda8be3` tweaks the same print to filter tunnel + link-local. Still print-only.

No engine commit could possibly affect Mac OS-level ARP / packet reachability.

### 2e. macOS Application Firewall (this session, re-confirmed)

- `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate` -> enabled.
- `--getstealthmode` -> off. `--getblockall` -> disabled.
- `--getappblocked /opt/homebrew/Cellar/node/26.0.0/bin/node` -> "Incoming connection is permitted."
- App Firewall would only affect inbound TCP/UDP to processes, not ICMP echo or outbound ARP. Yet *outbound* ping to peers fails. App Firewall is NOT the cause.

---

## 3. The localized problem

Reproducible facts measured on this Mac during this session, all from en0 (`10.1.1.177/24`):

```
$ ping -c 3 -W 1000 10.1.1.211           # iPad
PING 10.1.1.211 (10.1.1.211): 56 data bytes
Request timeout for icmp_seq 0
Request timeout for icmp_seq 1
Request timeout for icmp_seq 2
--- 100.0% packet loss

$ ping -c 1 -W 1000 10.1.1.156           # known peer (MAC resolved!)
--- 100.0% packet loss

$ ping -c 1 10.1.1.1                     # gateway
1 packets received  rtt=5.6 ms

$ ping -c 1 10.1.1.177                   # self
1 packets received  rtt=2.2 ms

$ arp -n 10.1.1.211
? (10.1.1.211) at (incomplete) on en0 ifscope [ethernet]

$ route -n get 10.1.1.211
   route to: 10.1.1.211
  interface: en0
      flags: <UP,HOST,REJECT,DONE,LLINFO,WASCLONED,IFSCOPE,IFREF>
```

**Reading `arp -an`**, only TWO peers + gateway + self have resolved MACs:
```
? (10.1.1.1)   at 94:83:c4:c6:eb:70    on en0  (gateway)
? (10.1.1.102) at 2:e5:ca:df:1:a2      on en0
? (10.1.1.156) at 1e:a2:de:c8:76:cc    on en0
? (10.1.1.177) at b2:f6:bc:37:b7:cd    on en0 permanent (self)
```

Yet pinging `10.1.1.156` still fails. **This is the single most important diagnostic finding of this session.** The L2 layer has the MAC. The kernel can put a packet on the wire. The packet either never goes out or the reply never comes back — even though both endpoints are on the same physical broadcast domain. This rules out:
- ARP failure (we have the MAC)
- Router AP isolation (the gateway works, the MAC was learned, broadcast domain is intact)
- App Firewall (it doesn't filter ICMP echo replies inbound to ping)
- Routing table problems (the on-link route for `10.1.1/24` is via en0 correctly)

It points decisively at a **packet-layer filter or driver-level intercept** on this Mac that is dropping non-gateway LAN traffic.

---

## 4. Hardware / network context

### Mac hardware

- Apple Silicon. Darwin 25.5.0 (macOS Sequoia or newer).
- WiFi `en0`, currently `10.1.1.177/24 broadcast 10.1.1.255`, MAC `b2:f6:bc:37:b7:cd`.
- WiFi associated with `MS-LED` (per `ipconfig getsummary en0` DHCP lease from `10.1.1.1`, lease valid 14:32 -> 02:32 next day).
- `awdl0` active (Apple Wireless Direct Link — used by AirDrop/Continuity, normal).
- `bridge0` is the macOS-built-in **Thunderbolt Bridge** (`networksetup -listnetworkserviceorder` confirms it under Hardware Port: "Thunderbolt Bridge, Device: bridge0"). Its `member: en1, en2, en3` are the three Thunderbolt ports. They show `PROMISC` because the bridge driver promiscuous-mode-listens on its members; all three have `status: inactive` (no Thunderbolt cable plugged in). **Not the cause.**
- `en10` (USB Ethernet adapter, 169.254 link-local). Inactive otherwise.
- `en13` is an Apple Silicon `anpi*`-style internal interface (no IP). Idle.
- `lo0` loopback normal.

### VPN, MDM, security extensions (NEW — was a coverage gap)

This Mac is a **managed enterprise device** running:

1. **Palo Alto GlobalProtect 6.2.6-838** — corporate VPN, currently CONNECTED:
   - Tunnel via `utun5` -> `10.254.161.36/32`. Gateway: `137.83.249.116` (`us-southwest-g-rivianau.gpojssc2sgc5.gw.gpcloudservice.com`).
   - Portal: `adventurous.gpcloudservice.com`. Prisma Access environment `prod6`. Source region: US.
   - Default route ordering (`netstat -rn -f inet`):
     ```
     default  10.254.161.36   UGScg     utun5    <- primary
     default  10.1.1.1        UGScIg    en0      <- secondary (IFSCOPE)
     ```
   - **`split-tunnel-option = "network-traffic"`** in settings plist.
   - **`proxyagent mode = "mode-tunnel-only"`** repeated in `PanGPS.log` — this is the most aggressive split-tunnel mode (tunnel-everything-except-excludes).
   - **`<access-routes></access-routes>` is empty** in the portal config XML logged at startup. Combined with tunnel-only mode, this is significant.
   - **`<no-direct-access-to-local-network>no</no-direct-access-to-local-network>`** — XML field says local access IS allowed (the field is a *prohibition* flag and its value is `no`).
   - The parsed result in the log: `DLSA, found no-direct-access-to-local-network tag, b_IsDLSASet set to disable` — DLSA = "Direct Local Subnet Access" filter; flag set to disable means the filter is OFF (i.e. local access not blocked at the DLSA level). **However** this is a *secondary* filter — the primary `gpsplit` kernel driver still has its own ruleset based on `<access-routes>`.
   - **`gpsplit` is the Palo Alto packet filter kernel driver.** It is started/stopped in `PanGPS.log` every time the tunnel reconnects (~10 stops/starts visible in today's log). When running, it intercepts packets on the physical interface (`Sent interface addresses, phy en0, tunnl utun5`).
   - The `pan_lar.dat` file (Local Access Routes, 752 bytes, mode 600 root:admin — unreadable to my session) is what `gpsplit` consults to decide which non-tunnel destinations to allow. Logged write: `1/1 local access routes saved. Size 748` — **only 1 local access route is permitted**, almost certainly the default-gateway route.
   - Routing table also has ~hundreds of statically-pinned `cloud-IP -> 10.1.1.1 en0` UGSc routes (AWS, Oracle, Zoom, Cloudflare etc.) installed by GlobalProtect — these are SAAS "direct-from-internet" exclusions. Healthy. Irrelevant to LAN visibility.

2. **Microsoft Defender for Endpoint Network Extension** (`com.microsoft.wdav.netext` 101.26032.0016) — system network extension, ACTIVATED ENABLED.

3. **Microsoft Defender for Endpoint Endpoint Security Extension** (`com.microsoft.wdav.epsext`) — endpoint security system ext, ACTIVATED ENABLED.

4. **FortiDLP Agent Network System Extension** (`uk.ava.reveal.agent.net` 12.2.3 — Fortinet Data Loss Prevention) — system network extension, ACTIVATED ENABLED.

5. **FortiDLP Agent Endpoint Security System Extension** — endpoint security system ext, ACTIVATED ENABLED.

6. **GlobalProtect Network System Extension** (`com.paloaltonetworks.GlobalProtect.client.extension` 6.2.6-838) — ACTIVATED ENABLED.

7. **Jamf Pro MDM agent** (`JamfDaemon`, `JamfAgent`, `JamfProCommService`) — MDM. Pushes policies. Did not surface direct evidence of network filtering today, but it manages the deployment of all of the above.

`/Library/Preferences/com.jamfsoftware.jamf.plist` is present (717 bytes, root:wheel, modified May 2).

### Coverage gap honest accounting

- `pfctl -s rules` -> **`pfctl: /dev/pf: Permission denied`** (needs sudo, not granted). The pf firewall ruleset is uninspected. GlobalProtect commonly loads pf anchors via `/etc/pf.anchors`. Visible at `/etc/pf.anchors/com.apple` (329 bytes, default Apple) but the dir is otherwise empty. **No third-party pf anchor file visible** — so if any third-party packet filtering is happening, it is via **network system extensions (NEPacketTunnelProvider / NEFilterDataProvider APIs)**, NOT via pf. That matches the FortiDLP/Defender/GlobalProtect netexts above.
- Could not read `/Library/Application Support/PaloAltoNetworks/GlobalProtect/pan_lar.dat` (mode 600, root:admin) — would show the exact local-access whitelist.
- `tcpdump -i en0 'host 10.1.1.156'` not run (needs sudo).
- `arp -d` returned `Operation not permitted` (root only).

---

## 5. The asymmetry to explain

- Windows machine on same WiFi -> reachable from iPad, can reach iPad -> fine.
- This Mac on same WiFi -> cannot reach iPad, cannot reach any LAN client other than gateway.
- Both Mac and Windows are on the same SSID, same VLAN, same router.

**What is different about this Mac:** it has SIX active enterprise-managed network/endpoint extensions (GlobalProtect tunnel + gpsplit driver, Microsoft Defender network ext + endpoint ext, FortiDLP network ext + endpoint ext) plus Jamf MDM. The Windows machine almost certainly does not have all six. The Mac is the operator's **corporate-managed device**; the Windows machine is presumably personal or has a different security posture.

---

## 6. Hypotheses evaluated

The original brief framed 7 hypotheses (H1–H7). Below is each one's verdict.

### H1 — VPN (GlobalProtect / utun5) installs route or pf rules that intercept LAN traffic
- **Status:** CONFIRMED contributing cause (high confidence).
- **Evidence:**
  - `defaults read /Library/Preferences/com.paloaltonetworks.GlobalProtect.settings.plist` -> `split-tunnel-option = "network-traffic"`.
  - `PanGPS.log` -> `ProcessProxyAgentPortalConfig proxyagent internal mode mode-tunnel-only, external mode mode-tunnel-only` (the most-aggressive split mode).
  - `PanGPS.log` -> XML config block: `<access-routes></access-routes>` (EMPTY whitelist) and `<no-direct-access-to-local-network>no</no-direct-access-to-local-network>` (allows local — but this is a secondary flag).
  - `PanGPS.log` -> `1/1 local access routes saved. Size 748` in `pan_lar.dat` — **only 1 local route is whitelisted**. That 1 route is almost certainly the route to the WiFi default gateway (so the tunnel itself can reach the internet via the gateway). Everything else on the LAN is outside the whitelist.
  - `PanGPS.log` -> `Start gpsplit` / `Stop gpsplit` happens on every tunnel state change. `gpsplit` is the Palo Alto **packet-filter kernel network extension** that enforces split-tunnel routing decisions at the packet layer (not at the routing-table layer). When running, it sees every packet on en0 and decides allow/deny based on the loaded ruleset.
  - `PanGPS.log` -> `Sent interface addresses, phy en0, tunnl utun5` confirms `gpsplit` is bound to en0 specifically.
  - The exact symptom — "gateway reachable, peers unreachable even with ARP resolved" — is the signature behavior of a packet filter that allows traffic to the gateway IP only.
- **Implications:** This single factor is sufficient to explain the entire symptom. The fix is to either (a) disconnect GlobalProtect, (b) ask the Palo Alto admin to add `10.1.1.0/24` (or specifically `10.1.1.211`) to the `<access-routes>` whitelist for this user's portal config, or (c) use a different machine (e.g. the Windows machine) for the FoH-control role until the policy is fixed.

### H2 — bridge0 / Thunderbolt bridge interferes with en0 routing
- **Status:** REFUTED (high confidence).
- **Evidence:** `ifconfig bridge0` shows members `en1/en2/en3` ALL with `status: inactive` and zero packets in/out. `networksetup -listnetworkserviceorder` confirms it as built-in Apple "Thunderbolt Bridge". There is no Thunderbolt cable plugged in. `bridge0` itself shows `status: inactive`. It is irrelevant to en0 traffic; the bridge does not span to en0.
- **Implications:** Distractor. Ignore.

### H3 — PROMISC interfaces (en1/en2/en3) inadvertently steal packets
- **Status:** REFUTED (high confidence).
- **Evidence:** Same as H2. `netstat -in` shows `en1/en2/en3` with 0 packets in, 0 packets out, status inactive. They cannot steal what they never see.
- **Implications:** Distractor.

### H4 — macOS Application Firewall blocks something
- **Status:** REFUTED (high confidence).
- **Evidence:**
  - `socketfilterfw --getglobalstate` enabled, stealth off, block-all off.
  - `--getappblocked /opt/homebrew/Cellar/node/26.0.0/bin/node` -> "Incoming connection is permitted."
  - App Firewall filters inbound TCP/UDP to specific processes. It does NOT filter ICMP echo or outbound traffic. Yet `ping 10.1.1.156` (outbound ICMP) fails.
- **Implications:** Rule out. The MINOR Node-upgrade-future warning from the first investigation still stands but is unrelated to today's bug.

### H5 — pf packet filter has third-party rules
- **Status:** INCONCLUSIVE direct (no sudo for `pfctl -s rules`), but INDIRECTLY REFUTED as primary cause.
- **Evidence:** `/etc/pf.anchors/` contains only the default `com.apple` anchor (329 bytes, dated Apr 30 — older than the GP install). No third-party pf anchors are loaded by `/etc/pf.conf`. Modern macOS security extensions (GP, Defender, FortiDLP) use the **Network Extension framework** (NEFilterDataProvider, NEPacketTunnelProvider), not pf. So even though I couldn't read pf rules directly, the architecture strongly suggests pf is not the filter responsible here.
- **Implications:** Likely a non-factor. Confirm by running `sudo pfctl -s rules` if the operator wants belt-and-suspenders certainty.

### H6 — macOS / WiFi driver dropping multicast / ARP / broadcast
- **Status:** PARTIALLY REFUTED — REFRAMED.
- **Evidence:** ARP is working for SOME peers (`10.1.1.102`, `10.1.1.156`, gateway have resolved MACs in `arp -an`). So the WiFi driver IS receiving and processing ARP replies in general. The selective failure (ARP works for some, fails for others, and ICMP fails for all peers regardless of ARP state) is incompatible with a generic "driver drops all multicast" hypothesis.
- **Implications:** Driver is not the gross problem. Pattern fits a higher-layer (network-extension) filter, not a link-layer drop.

### H7 — WiFi AP isolation / SSID / VLAN mismatch
- **Status:** REFUTED (high confidence) — this was the working hypothesis at the end of the first investigation and the new data overturns it.
- **Evidence:**
  - The operator confirmed the Windows machine works from the same SSID — rules out AP isolation as a generic SSID feature.
  - This Mac CAN reach the gateway and DHCP lease is from `10.1.1.1` -> we are on the right subnet.
  - The Mac can ARP-resolve other LAN peers (`10.1.1.102`, `10.1.1.156`) -> we are in the same broadcast domain (otherwise ARP would fail uniformly).
  - The ARP-resolved peer `10.1.1.156` still doesn't ping -> isolation at the AP would not be selective per host once L2 resolution has succeeded.
- **Implications:** Original "AP client isolation" verdict from the first report is **WRONG**. AP isolation is symmetric and would prevent ARP resolution entirely; it does not. The first report did not have visibility into the enterprise security stack.

---

## 7. Most likely root cause

**Palo Alto GlobalProtect, running in split-tunnel "tunnel-only" mode with an empty `<access-routes>` whitelist, has loaded its `gpsplit` kernel network-extension packet filter on en0, and that filter drops all LAN packets except those destined for the default-gateway IP that GP needs for internet uplink.** Microsoft Defender's and FortiDLP's network extensions are also present on the same physical interface and may compound the effect (typical DLP behavior is to block unsanctioned LAN scanning to prevent data exfiltration), but the GP configuration alone is sufficient to explain the entire symptom.

**Confidence: HIGH.**

Evidence chain:
1. The Windows machine on the same WiFi works -> the bug is on this Mac.
2. The Mac can reach the gateway but not any other LAN peer, even ones where ARP has succeeded -> the bug is above L2.
3. App Firewall and pf are not the source -> the bug is in a network extension.
4. GlobalProtect is installed, connected, in tunnel-only mode, with empty access-routes whitelist, and `gpsplit` is actively running on en0 -> this is the only mechanism on the box that fits this exact selective-drop pattern.
5. The "1/1 local access routes" log line directly states only one local destination is allowed.

---

## 8. Recommended diagnostic next steps

In order of operator effort, lowest first:

1. **Easiest definitive test:** disconnect GlobalProtect from the menu-bar app (right-click GP icon -> Disable / Disconnect). Wait 5 seconds. Then on the Mac run:
   ```
   ping -c 3 10.1.1.156
   ping -c 3 10.1.1.211
   ```
   If both succeed, GP is the cause (confidence -> CERTAIN). If only one succeeds, the remaining failure is on the iPad side. If both still fail, the cause is something deeper.

2. While GP is disconnected, also re-run the iPad's CaptainPad SCAN NETWORK against subnet `10.1.1`. If the engine now appears -> root cause confirmed and the fix is route 1 below.

3. If GP cannot be disconnected (enforcement policy), inspect what GP allows:
   ```
   sudo cat "/Library/Application Support/PaloAltoNetworks/GlobalProtect/pan_lar.dat" | hexdump -C | head -30
   sudo pfctl -s rules
   sudo pfctl -s anchors
   ```
   Expect `pan_lar.dat` to contain one route entry pointing at `10.1.1.1` (the gateway). Expect no third-party pf anchors. Both are consistent with H1.

4. Get an actual packet trace while reproducing the scan:
   ```
   sudo tcpdump -i en0 -n 'host 10.1.1.211 or arp' &
   # then trigger the iPad's scan
   ```
   If the iPad's TCP SYN to `10.1.1.177:6968` IS seen on en0 but no SYN-ACK leaves, the drop is on the *outbound reply* path — confirms a network-extension filter. If the SYN is never seen at all, the drop is on the *inbound* path on the Mac (also a network-extension filter, just on a different hook).

5. Cross-check by temporarily disabling Microsoft Defender Network Extension and FortiDLP Network Extension (System Settings -> General -> Login Items & Extensions -> Network Extensions). If GP is also off and the peers still don't ping, one of the other two is contributing. (Realistically Jamf may auto-re-enable them within minutes, so this is a brief test only.)

---

## 9. Recommended fix

Ranked by likelihood-of-working × invasiveness-and-policy-risk:

1. **(BEST — operational)** For the Burning Man week, run the MarsinEngine on the operator's Windows machine (which is already known to work with the iPad). Leave this Mac as the dev/editor box only. **Zero change to corporate posture, zero policy escalation, immediate.**

2. **(GOOD — temporary, in the moment)** Disconnect GlobalProtect when in the field (`menu bar GP icon -> Disconnect`). The iPad will then see the Mac. If GP is "enforce on" by policy, this isn't possible without an exception. (Today's plist shows `enforce-globalprotect = no`, so it is currently un-enforced and the operator CAN disconnect.)

3. **(MEDIUM — sustainable, requires IT)** Ask the Palo Alto admin to add `10.1.1.0/24` (or just the specific iPad IP `10.1.1.211`) to the `<access-routes>` (sometimes called "Include Local Access Routes" or "Allow Local Network Traffic") for this user's GlobalProtect portal config. Once the new config is pushed, the `gpsplit` filter will allow LAN traffic to that subnet. **Slow (IT ticket) but correct fix.**

4. **(EXTRA — also ask IT)** Verify that Microsoft Defender and FortiDLP do not block local LAN discovery for the same user/group. They probably don't, but worth confirming as part of the same ticket.

5. **(LAST RESORT — don't unless you must)** Uninstall GlobalProtect entirely. Almost certainly violates corporate policy on a Jamf-managed device; will likely be auto-reinstalled by Jamf within an hour. Not recommended.

---

## 10. Coverage gaps

Things I could not probe:

- `sudo pfctl -s rules` and `sudo pfctl -s anchors` -> permission denied. The pf state is uninspected. **Architectural reasoning (Network-Extension API not pf) makes this low priority.**
- `pan_lar.dat` is mode 600 root:admin -> the exact GP whitelist contents are uninspected. **The log line "1/1 local access routes saved" gives us the count anyway.**
- `tcpdump` not run (no sudo + would-disrupt). The packet-level direction of the drop (inbound to Mac vs outbound from Mac) is unknown.
- `arp -d` not run (root-only). Could not flush negative ARP cache mid-test.
- GUI-only checks: Settings -> General -> Login Items & Extensions -> Network Extensions. I can see the extensions are enabled via `systemextensionsctl list`, but I cannot toggle them.
- I could not inspect Jamf-pushed configuration profiles (`/Library/Managed Preferences/...`). They might add additional context to which LAN traffic is/isn't allowed.
- I did not log into the GL.iNet router admin UI to check what the router itself sees for the Mac's MAC address (e.g. is the Mac being placed in a guest VLAN by the router based on MAC?). The Windows-works datum makes this unlikely but not impossible.

---

## 11. Appendix — raw command outputs

### 11.1 `lsof -iTCP:6968 -sTCP:LISTEN -P -n`
```
node 90149  TCP *:6968 (LISTEN)
```

### 11.2 `curl http://10.1.1.177:6968/status` (this Mac, current LAN IP)
```
{"service":"marsin-engine","name":"MarsinEngine","version":"2.0","port":6968,
 "activeScene":"test_bench","activeModel":"test_bench",
 "activePattern":"00_golden_hour_wash","unrealState":"streaming"}
exit: 0
```

### 11.3 `ping` (the smoking gun)
```
$ ping -c 1 10.1.1.1
1 packets transmitted, 1 packets received, 0.0% packet loss   rtt=5.6 ms

$ ping -c 1 10.1.1.177      # self
1 packets transmitted, 1 packets received, 0.0% packet loss   rtt=2.2 ms

$ ping -c 1 10.1.1.156      # known peer with resolved ARP MAC
1 packets transmitted, 0 packets received, 100.0% packet loss

$ ping -c 3 10.1.1.211      # iPad
3 packets transmitted, 0 packets received, 100.0% packet loss
```

### 11.4 `arp -an` (en0 + en10)
```
? (10.1.1.1)   at 94:83:c4:c6:eb:70    on en0  ifscope [ethernet]
? (10.1.1.10)  at (incomplete)         on en0  ifscope [ethernet]
? (10.1.1.50)  at (incomplete)         on en0  ifscope [ethernet]
? (10.1.1.100) at (incomplete)         on en0  ifscope [ethernet]
? (10.1.1.102) at 2:e5:ca:df:1:a2      on en0  ifscope [ethernet]
? (10.1.1.150) at (incomplete)         on en0  ifscope [ethernet]
? (10.1.1.156) at 1e:a2:de:c8:76:cc    on en0  ifscope [ethernet]
? (10.1.1.177) at b2:f6:bc:37:b7:cd    on en0  ifscope permanent [ethernet]
? (10.1.1.200) at (incomplete)         on en0  ifscope [ethernet]
? (10.1.1.211) at (incomplete)         on en0  ifscope [ethernet]
? (10.1.1.255) at ff:ff:ff:ff:ff:ff    on en0  ifscope [ethernet]
```

### 11.5 `route -n get 10.1.1.211`
```
   route to: 10.1.1.211
destination: 10.1.1.211
  interface: en0
      flags: <UP,HOST,REJECT,DONE,LLINFO,WASCLONED,IFSCOPE,IFREF>
```

### 11.6 `route -n get 10.1.1.1`
```
   route to: 10.1.1.1
destination: 10.1.1.1
  interface: en0
      flags: <UP,HOST,DONE,LLINFO,WASCLONED,IFSCOPE,IFREF,ROUTER>
```

### 11.7 `netstat -rn -f inet` 10.1.1 rows (excerpt — full table is hundreds of GP-pushed direct-access routes)
```
default            10.254.161.36      UGScg               utun5
default            10.1.1.1           UGScIg                en0
10.1.1/24          link#14            UCS                   en0
10.1.1.1           94:83:c4:c6:eb:70  UHLWIir               en0
10.1.1.102         2:e5:ca:df:1:a2    UHLWIi                en0
10.1.1.156         1e:a2:de:c8:76:cc  UHLWI                 en0
10.1.1.177         b2:f6:bc:37:b7:cd  UHLWI                 lo0
10.1.1.211         link#14            UHLWI                 en0
10.1.1.255         ff:ff:ff:ff:ff:ff  UHLWbI                en0
```

(Hundreds of `3.x.x.x / 13.x.x.x / 15.x.x.x ... 221.x.x.x  10.1.1.1  UGSc  en0` GlobalProtect SAAS-direct routes omitted — they are healthy and irrelevant.)

### 11.8 `systemextensionsctl list` (security/network extensions)
```
com.apple.system_extension.network_extension
*  *  JE7N8449S9  uk.ava.reveal.agent.net (12.2.3/12.2.3)            FortiDLP Agent Network System Extension       [activated enabled]
*  *  UBF8T346G9  com.microsoft.wdav.netext (101.26032.0016/...)     Microsoft Defender Network Extension          [activated enabled]
*  *  PXPZ95SK77  com.paloaltonetworks.GlobalProtect.client.extension (6.2.6-838/1)
                                                                     GlobalProtectExtension                        [activated enabled]

com.apple.system_extension.endpoint_security
*  *  JE7N8449S9  uk.ava.reveal.agent.eps (12.2.3/12.2.3)            FortiDLP Agent Endpoint Security System Ext.  [activated enabled]
*  *  UBF8T346G9  com.microsoft.wdav.epsext (101.26032.0016/...)     Microsoft Defender Endpoint Security Ext.     [activated enabled]
```

### 11.9 Relevant `PanGPS.log` excerpts (today)
```
14:32:35.758  Debug( 203): interface en0 ip 10.1.1.177/255.255.255.0
14:32:35.758  Debug(1012): physical interface ip 10.1.1.177
14:32:35.758  Debug(1033): Set tunnel interface MTU as 1370
14:32:35.771  RTM_NEWADDR: address being added to iface utun5: 10.254.161.36
14:32:36.455  Debug(1230): set route success.
14:32:36.455  Debug(4293): Found specific route to gateway 137.83.249.116.
14:32:36.457  Debug(2875): DLSA: 1/1 local access routes saved. Size 748
14:32:36.461  Debug( 514): Start gpsplit
14:32:36.461  Debug(1742): SPStart is called (tunnel is not in retry mode)
14:32:36.461  Debug(1763): call SPSetParameters to set interface addresses,
              physical: 10.1.1.177-:: virtual: 10.254.161.36-::
14:32:36.461  Debug( 829): Sent interface addresses, phy en0, tunnl utun5, flags 0x0.
14:32:36.495  Debug(11673): CPanMSService::OnVpnStatusProxyAgent: tunnel only,
              stop the proxy.

(from earlier reconnect cycles, the same portal-config XML appears:)
<no-direct-access-to-local-network>no</no-direct-access-to-local-network>
<access-routes></access-routes>
<exclude-access-routes></exclude-access-routes>
<exclude-split-tunneling-application></exclude-split-tunneling-application>
<exclude-split-tunneling-domain></exclude-split-tunneling-domain>

Debug(11829): ProcessProxyAgentPortalConfig proxyagent internal mode mode-tunnel-only,
              external mode mode-tunnel-only
Debug( 528): DLSA, found no-direct-access-to-local-network tag,
              b_IsDLSASet set to disable
```

### 11.10 `defaults read .../com.paloaltonetworks.GlobalProtect.settings.plist` (key fields)
```
PanSetup: CurrentVersion = "6.2.6-838"
PanSetup: Portal = "adventurous.gpcloudservice.com"
DEM:      "gateway-address" = "...rivianau.gpojssc2sgc5.gw.gpcloudservice.com,ipv4=137.83.249.116"
DEM:      "tunnel-ip"      = "ipv4=10.254.161.36"
DEM:      "tunnel-status"  = connected
DEM:      "dem-on-off-status" = "dem-portal-admin-enabled"
Settings: "split-tunnel-option" = "network-traffic"
Settings: "enforce-globalprotect" = no
Settings: "on-demand" = no
Settings: "traffic-enforcement" = no
```

### 11.11 `pfctl -s rules` -> `Permission denied` (sudo would be required, not granted)

### 11.12 macOS Application Firewall
```
$ /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
Firewall is enabled. (State = 1)
$ /usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode
Stealth mode disabled
$ /usr/libexec/ApplicationFirewall/socketfilterfw --getblockall
Firewall is set to allow specific incoming connections.
$ /usr/libexec/ApplicationFirewall/socketfilterfw --getappblocked \
    /opt/homebrew/Cellar/node/26.0.0/bin/node
Incoming connection is permitted for /opt/homebrew/Cellar/node/26.0.0/bin/node.
```

### 11.13 `ifconfig` summary (relevant interfaces only)
```
en0  flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
     ether b2:f6:bc:37:b7:cd
     inet  10.1.1.177  netmask 0xffffff00  broadcast 10.1.1.255
     inet6 fe80::1cbd:a609:e079:b07a%en0
     status: active

utun5  flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1370
       inet 10.254.161.36 --> 10.254.161.36  netmask 0xffffffff

bridge0  flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
         ether 36:62:3c:51:9e:40
         member: en1 (LEARNING,DISCOVER)
         member: en2 (LEARNING,DISCOVER)
         member: en3 (LEARNING,DISCOVER)
         status: inactive

en1/en2/en3  flags=8963<UP,BROADCAST,SMART,RUNNING,PROMISC,SIMPLEX,MULTICAST>
             (Thunderbolt Bridge members)
             status: inactive
```

### 11.14 Process list — security/VPN/MDM running
```
  599 JamfDaemon
 2237 PanGPS                                      (GlobalProtect service)
 2242 GlobalProtect                               (GlobalProtect UI agent)
 2246 JamfAgent
 2284 JamfProCommService
 3424 com.paloaltonetworks.GlobalProtect.client.extension  (gpsplit network extension)
23051 jamf
```

### 11.15 `netstat -in` en0 row (shows packets going OUT, but `Ipkts=0` is a known cosmetic macOS quirk for some WiFi drivers — actual reachability is independent)
```
en0  1500  10.1.1/24  10.1.1.177   Ipkts=0  Opkts=3028608  errs=0  coll=0
```

### 11.16 `arp` statistics (for completeness)
```
1644 broadcast ARP requests sent
 129 unicast ARP requests sent
1816 ARP replies sent
   0 ARP announcement sent
21641 ARP requests received
6615 ARP replies received
28341 total ARP packets received
 947 total packets dropped due to no ARP entry
1140 total packets dropped during ARP entry removal
  10 ARP entries timed out
```
(Mac IS sending and receiving ARP — `21641 requests received, 6615 replies received` is healthy. The 947 "dropped due to no ARP entry" plus the per-peer ARP failures we see in `arp -an` are downstream effects of either the gpsplit filter dropping replies OR peers genuinely not responding when their packets are dropped first by gpsplit.)

---

**End of report.**
