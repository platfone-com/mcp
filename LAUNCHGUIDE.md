# Platfone — Virtual Numbers MCP

## Tagline
Rent virtual phone numbers and receive SMS through your AI agent.

## Description
Platfone MCP connects AI agents (Claude, Cursor, VS Code Copilot) to Platfone's virtual phone number platform. Agents can check pricing, rent a virtual number from 200+ countries, poll for incoming SMS, and cancel activations with auto-refund — all through 6 MCP tools.

Built for QA automation, developer workflows, and SMS verification testing. Supports both stdio (local) and Streamable HTTP (remote) transports. Open-source under MIT, the underlying API is pay-per-use with no subscription.

## Setup Requirements
- `PLATFONE_API_KEY` (required): Your Platfone API key. Sign up and generate one at https://platfone.com/app/api

## Category
Developer Tools

## Use Cases
QA Automation, SMS Verification Testing, Agent Workflows, Developer Tools, Prototyping

## Features
- Check available phone numbers and live pricing for any country + service pair
- Rent a virtual phone number from 200+ countries
- Receive and parse incoming SMS, including auto-extracted verification codes
- Cancel activations with automatic refund when no SMS arrives
- Retry an activation to request another SMS on the same number
- Check account balance (available + reserved funds)
- Works with Claude Desktop, Cursor, VS Code Copilot, and any MCP-compatible client
- Supports both stdio (local) and Streamable HTTP (hosted) transports
- Hosted endpoint available at https://mcp.platfone.com/mcp — no install required
- Open-source, MIT-licensed

## Getting Started
- "Rent a US virtual number for Telegram and give me the SMS code when it arrives"
- "Check the price for receiving SMS from WhatsApp in Germany"
- "What is my Platfone account balance?"
- Tool: get_balance — Returns available and reserved funds in USD cents
- Tool: check_price — Get min/max/suggested price and number availability for a country + service pair
- Tool: order_number — Rent a virtual number; returns phone, activation_id, expiry, retriable flag
- Tool: check_sms — Poll an activation for incoming SMS text and parsed verification code
- Tool: cancel_activation — Cancel an activation and trigger an auto-refund
- Tool: retry_activation — Request an additional SMS on the same rented number

## Tags
mcp, virtual-numbers, phone-numbers, sms, sms-verification, qa-automation, ai-agents, claude, cursor, vs-code, developer-tools, testing, prototyping, otp-testing, telephony

## Documentation URL
https://platfone.com/docs/mcp/

## Health Check URL
https://mcp.platfone.com/mcp
