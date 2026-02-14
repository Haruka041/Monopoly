## UX & Network Experience Optimization (HF Free Tier)
Date: 2026-02-14

### Understanding Summary
- Goal: reduce perceived stutter and frustration by making network state and turn flow obvious.
- Scope: client UX improvements and light experience protection only.
- Non-goals: no architecture changes, no new infra, no protocol changes.
- Constraints: HF Space free tier, no added services or paid dependencies.
- Priority areas: reconnection clarity, network feedback, turn visibility, action feedback.
- Delivery: implement locally, test locally, do not push until user review.

### Assumptions
- Existing reconnect/heartbeat logic remains unchanged.
- UX changes can be done within current Vue components and store usage.
- We can add small UI states and animations without performance impact.
- No requirement to change round time or game rules.

### Decision Log
1) Use non-blocking, low-noise connection status cues instead of modal popups.
2) Keep reconnect behavior as-is; only enhance visibility and cadence of prompts.
3) Highlight turn state in multiple synchronized UI locations to reduce ambiguity.
4) Prefer soft-disable/feedback on actions over hiding controls to reduce “no response” perception.
5) Validate changes with local UX tests (throttle/offline) before any push.

### Final Design

#### 1) Connection & Reconnect Experience Layer
- Add a compact connection status tag near the existing ping indicator:
  - States: `连接中 / 已连接 / 网络波动 / 正在重连 / 已恢复`
  - Color-coded to match current UI palette.
- Reconnect feedback:
  - Non-blocking banner/toast that shows attempt counts and short status text.
  - “已恢复” appears briefly (2–3s) on success and auto-dismisses.
- Jitter handling:
  - If ping spikes or fluctuates but reconnect is not triggered, show “网络波动” only.
  - Avoid strong alerts for short, self-resolving blips.
- Player offline hint:
  - Keep existing offline marker and add a subtle “重连中” hint in the card tooltip or microtext.

#### 2) Turn Clarity & Action Feedback
- Turn focus:
  - Emphasize current player in `RoundInfo` and player list with highlight/outline.
  - Add a short “轮到你了” cue near the dice when it’s the player’s turn.
- Countdown visibility:
  - Increase contrast and apply color shift when time is low (e.g., <= 5s).
  - Use gentle pulse animation, not disruptive flashing.
- Action feedback:
  - On dice roll / card selection / end-turn, show “已提交/处理中” for ~0.5–1s.
  - Keep UI responsive without altering game logic.
- Log confirmation:
  - Briefly highlight the latest relevant log item (dice result, card effect).

#### 3) Implementation Notes (No Logic Changes)
- Update existing components only, minimal state additions:
  - `monopoly-client/src/views/status_bar/components/ping.vue`
  - `monopoly-client/src/views/game/components/round-info.vue`
  - `monopoly-client/src/views/game/components/player-card.vue`
  - `monopoly-client/src/views/game/components/countdown-timer.vue`
  - `monopoly-client/src/views/game/components/dices.vue`
- Optional: small shared status component or helper for connection text mapping.
- No changes to server logic, turn length, or WebSocket reconnect policy.

#### 4) Local Test Plan (No Push)
- Simulate offline/weak network via browser devtools:
  - Confirm reconnect banner timing and non-blocking behavior.
  - Ensure “网络波动” appears without noisy popups.
- Turn flow verification:
  - Ensure turn highlight + “轮到你了” is consistent.
  - Verify countdown emphasis triggers at threshold and is readable.
- Action feedback:
  - Ensure short “已提交/处理中” does not block interaction.
  - Confirm no layout shifts or jitter in UI.

### Risks & Mitigations
- Risk: UI noise. Mitigation: use subtle, short-lived cues and avoid modal dialogs.
- Risk: Performance regressions. Mitigation: only light CSS animation and small DOM additions.
