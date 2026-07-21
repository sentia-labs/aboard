---
name: manage
description: Start or attach the current Claude Code session as the aboard coordinator, so it can observe every worker topic and relay messages back to workers. Use when the user says things like "/manage", "become the coordinator", "start coordinating my workers", or "watch all aboard topics".
argument-hint: (no arguments)
allowed-tools: Bash(npx aboard-server*), Bash(node *), Bash(curl *), Bash(cat *), Bash(mkdir *), Bash(uuidgen*), mcp__plugin_aboard_aboard-mcp__coordination_get_server_status, mcp__plugin_aboard_aboard-mcp__coordination_register_agent, mcp__plugin_aboard_aboard-mcp__coordination_claim_coordinator, mcp__plugin_aboard_aboard-mcp__coordination_subscribe, mcp__plugin_aboard_aboard-mcp__coordination_wait_for_message, mcp__plugin_aboard_aboard-mcp__coordination_list_agents, mcp__plugin_aboard_aboard-mcp__coordination_list_topics, mcp__plugin_aboard_aboard-mcp__coordination_publish
---

# manage

Starts or attaches the current session as the aboard **coordinator**.

## Steps

1. **Discover / start the server.**
   Call `coordination_get_server_status`. If it fails to connect, the server
   is not running yet: start it in the background with a command such as
   `nohup npx aboard-server > /tmp/aboard-server.log 2>&1 & disown` and retry
   `coordination_get_server_status` a few times (short sleep between
   retries) until it reports healthy.

2. **Determine this agent's identity.**
   Reuse the native Claude Code session identifier when one is available in
   the environment (check `$CLAUDE_CODE_BRIDGE_SESSION_ID`, then
   `$CLAUDE_CODE_REMOTE_SESSION_ID`, then `$CLAUDE_SESSION_ID`). If none are
   set, fall back to a generated UUID (`uuidgen`, or
   `node -e "console.log(crypto.randomUUID())"`) and remember it for the
   rest of this session — do not regenerate it on every tool call.

3. **Register as coordinator.**
   Call `coordination_register_agent` with `role: "coordinator"` and the
   agentId from step 2.

4. **Check for an existing coordinator and claim the role.**
   Call `coordination_claim_coordinator` with your agentId.
   - If it succeeds, you are now the coordinator.
   - If it reports a conflict, another session already coordinates. Tell the
     user another coordinator is active and offer to attach as a passive
     observer instead (skip step 5's wildcard subscribe/claim retry, or ask
     the user whether to proceed anyway).

5. **Subscribe to every topic.**
   Call `coordination_subscribe` with `topic: "*"`. Keep the returned
   `subscriptionId`.

6. **Begin waiting for messages.**
   Repeatedly call `coordination_wait_for_message` with that
   `subscriptionId` (pick a reasonable `timeoutMs`, e.g. 60000). On each
   message:
   - Summarize it for the user in your own words.
   - Decide whether it needs the user's attention (surface it clearly if
     so) or can be handled autonomously.
   - If a reply to the worker is warranted, use `coordination_publish` with
     the worker's topic to send it back.
   - On `timeout`, just call `coordination_wait_for_message` again — this is
     normal and does not need to be reported to the user.

Remember: the server owns no persistent state. If it restarts, everything
(agents, topics, subscriptions) disappears and this flow must run again.
