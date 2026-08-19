# Product Marketing Context

**Document version:** v12
**Last updated:** 2026-08-19

> Auto-drafted from the public site, console copy, and architecture. Sections marked **inferred** are reasoned from product design, not from interviews or live customers. Correct those first.

## Product Overview
**Product name:** Branderize. Console wordmark: Branderize CMO. Never call the product Magister — Magister is an internal benchmark only.
**One-liner:** The AI CMO you can trust.
**What it does:** Branderize is a marketing workspace with a CMO and specialist agents. Goals, brand context, and what got made live on one work graph, so the team works from the same record. You write what the brand is trying to do, add the website, and open anything later with the goal still attached. How a person talks to the CMO is an implementation detail — not a benefit to sell. Do not publish how many specialists there are; the roster can change.
**Product category:** AI marketing team / AI CMO workspace (how customers search: “AI CMO,” “AI marketing team,” “marketing agent,” “fractional CMO software”).
**Product type:** Multi-tenant SaaS.
**Business model:** Early access today; planned credit-based SaaS (monthly credit pool per plan, metered model and action consumption, paid overage). Public pricing is not on the site yet. Organizations can hold many brands. Sign-in is passwordless email OTP.

## Target Audience
**ICP:** Same as Magister’s: SaaS founders, solo marketers, and lean growth teams — marketers who would rather ship than plan. Same buyers, different product. First tenant is Branderize itself (dogfooding).
**Target companies:** SaaS and other digital product companies with a public website and more marketing work than people. Lean teams, not large marketing orgs.
**Decision-makers:** The founder between product calls; the solo marketer who already knows what should happen; the growth-team lead sitting on a backlog. They own the brand goal. The team sees the goal and the work.
**Primary use case:** Start marketing from a written goal and a real website, then keep that “why” attached to everything that gets made.
**Jobs to be done:**
- Get a clear direction on record before anyone produces work.
- Have a CMO and specialists execute against that goal, not against a prompt that disappears.
- Open any piece of work later and still see the goal it came from.
**Use cases:**
- First-week onboarding: name the brand, write the first goal, add the website, import Brand Context, talk to the CMO.
- Keep positioning and sales-team clarity as a shared goal (“Make the positioning clear to the sales team.”).
- Approve publish, send, or spend later — the team prepares; a person commits.

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| SaaS founder (user, champion, often buyer) | Shipping marketing in the 30 minutes between product calls, without losing the why | No time for a team or a brief that survives the handoff | Write the goal. Add the website. See why something was made. |
| Solo marketer (user / champion) | Getting through the list they already know is right | They know what should happen; they cannot do all of it and still keep direction attached | Shared goal and work. Nothing ships without them. |
| Growth team (users + champion) | Clearing a backlog without the goal falling off the work | More tasks than people; artifacts arrive with no source | The goal stays on whatever got made. Publish, send, and spend wait for a person. |
| Team member | Shared direction and artifacts they can trust | Work arrives without source or context | The goal and the work are on the team. Open something that got made — the goal is right there. |
| Financial buyer (often the founder) | Predictable credits, no surprise spend | Usage-based AI that runs away | Planned monthly pool + overage; spend and publish stay human-approved. Pricing not public yet. |
| Technical influencer | That work can be trusted and scoped to their company | Chat tools invent answers and hide where they came from | The workspace is the source of truth. Chat is just how you talk to the CMO. |

## Problems & Pain Points
**Core problem:** Marketing starts as a file or a chat. The goal falls off the work the moment it leaves your hands.
**Why alternatives fall short:**
- ChatGPT / generic AI: the prompt dies; the work has no source.
- AI marketing agents (the Magister-shaped category): talk, then autonomous ship. Chat and execution are the product. The goal is a prompt that disappears.
- Docs, Slack, Notion: the brief, the debate, and the output live in three places. Why something was made is tribal knowledge.
- Agencies / fractional CMOs: judgment walks out of the room; the team inherits files, not the conversation that made them.
**What it costs them:** Rework, off-brief creative, sales that cannot explain the claim, and a founder who has to re-explain the goal every week.
**Emotional tension:** “We made this and nobody can say why.”

## Competitive Landscape
**Internal benchmark:** [Magister Marketing](https://magistermarketing.com/) (`magistermarketing.com`). Not Branderize. Not our name. Not our public positioning. We use it only to study the category we are entering.

What Magister sells, in its own words: an **autonomous AI marketing agent** that audits, writes, and ships marketing across SEO, content, ads, and social, starting from a website URL. Method: talk to it → it plans and executes → you review and ship. Surfaces: web app, Slack, MCP into Claude/ChatGPT, and agent-native signup. One agent, 100+ skills, company brain, brand kit from the site, workflows on a schedule, analytics that feed the next round. Commercial shape we borrowed as a *market* reference, not a brand: organizations with many brands, seats, monthly credit pools, overage. Public prices (as of 2026-08-19): Free trial (300 credits, one brand); Connect $99/mo (5,000 credits); Agent $199/mo (10,000 credits, dedicated hosted machine); extra usage $0.02/credit; extra brand/seat add-ons. Their ICP is also ours: SaaS founders, solo marketers, growth teams — “marketers who’d rather ship than plan.” Same people; we do not copy their autonomous-ship offer.

Where the benchmark falls short for *our* product: Magister makes chat and unattended execution the product (“always running,” publish “without you in the loop,” dedicated server that keeps working). The goal is a prompt that disappears. Branderize starts with a written goal, keeps that goal on the work, and does not publish, send, or spend without a person. Per-user CMO sessions are not a contrast to sell.

Do not describe Branderize as “Magister with different internals,” “our Magister,” or introduce the product as Magister.

**Direct:** Other AI marketing-agent platforms in the same search set (Magister is the named benchmark in that set, not us). They optimize for audits, plans, and connected shipping. They fall short because autonomy and feature surface are the product.
**Secondary:** Jasper, Copy.ai, and other AI writing/SEO suites — they draft artifacts without a durable brand goal. HubSpot / marketing clouds — they store campaigns, not the judgment that authorized them.
**Indirect:** A human fractional CMO or agency; ChatGPT + Notion + Slack; “we’ll hire later.” Falls short because the conversation and the work never share one source of truth, and switching people loses the why.

## Differentiation
**Key differentiators:**
- The center is the work, not the chat.
- You can always see why something was made.
- Nothing publishes, sends, or spends without a person.
- Marketing starts with the goal, not the file you hand over.
**How we do it differently:** Against the Magister benchmark: they say talk → execute → review, and keep the agent running. We say write the goal first, add a real website, and keep publish/send/spend on a person. Brand context comes from the site, not invention. Specialists work against that goal; the team opens the work and still sees it.
**Why that's better:** Direction is on the record before production. Public work does not happen without a person.
**Why customers choose us:** **Inferred until we have buyers.** They want marketing work that stays tied to a goal — not another chat that drafts posts. Do not pitch per-user CMO privacy as a reason.

## Objections
| Objection | Response |
|-----------|----------|
| “This is just another AI marketing tool.” | Chat is not the source of truth. The goal, Brand Context, and work are. Open anything that got made — the goal is still there. |
| “Will it post or spend without me?” | No. Preparation can be automatic. Publish, send, activate, and spend wait for a human button. |
| “We’re too early / we don’t have a marketing team.” | That is the wedge. Write the first goal. Add the website. That is enough to begin. |
| “What does it cost?” | Early access. Planned credit pool per plan with metered usage and overage. Public pricing is not published yet — do not invent a number. |

**Anti-persona:** Teams that want fully unattended publishing or ad spend. Buyers who only want a copy generator. Enterprises that need SSO, SCIM, or brand-level ACLs beyond v1 organization roles. Anyone without a public HTTPS website they can start from.

## Switching Dynamics
**Push:** Briefs lose their why. Chat tools leave no shared record. Work arrives with no source.
**Pull:** A written goal the team can share. Work that still shows why it was made. Nothing public without a person.
**Habit:** Slack threads, Notion docs, ChatGPT projects, an agency retainer, “we’ll just ship the landing page.”
**Anxiety:** The AI will do something public. Early-access product; credits and pricing are still forming.

## Customer Language
**How they describe the problem:**
- No live customer quotes yet. Product copy already names the problem: “A brief loses its why the moment it leaves your hands.”
**How they describe us:**
- No live customer quotes yet. Site and console voice:
- “Write what the brand is trying to do. Add the website.”
- “You can still see why something was made.”
- “Name the outcome the brand must get. Not a task list.”
Public landing now leads with the official one-liner. Do not revive “A clear direction. Before the work.” or “The goal is shared. The chat is not.”
**Words to use:** Branderize, Branderize CMO, The AI CMO you can trust, goal, website, brand context, shared work, why it was made, early access. Work graph is allowed when you mean the connected record — once, not as the product name. Specialists, not a headcount.
**Words to avoid:** Object, Action, provenance, Intent (in public copy — say goal), “external commitment,” owner-private, selling “private CMO chat,” “six specialists” or any roster count. Do not repeat “work graph” in every section or use it to explain internals. Magister in customer-facing copy. chatbot, copilot, autopilot, “set and forget,” “AI that runs your marketing,” growth hacking, magic, “just chat with it,” unattended publish/spend. Do not call the CMO chat the product. Do not promise public pricing or customer logos we do not have. Never say the application is Magister.
**Glossary:**
| Term | Meaning |
|------|---------|
| Branderize | The product. The only name to use with customers. |
| Magister | Internal benchmark only: [Magister Marketing](https://magistermarketing.com/), an autonomous AI marketing agent (chat → execute → review; orgs, brands, credits). Not our application. Not for public copy. |
| Goal | What the brand is trying to do, in the customer’s words. Shared with the team. Internally called Intent — do not use that word in public copy. |
| Brand context | What we know about the brand from its real website and assets. Not invented. |
| CMO | The lead agent. Turns talk into a written goal and sends work to specialists. How the chat is scoped is not a value. |
| Work | Something that got made. You can still see the goal it came from. |
| Work graph | The shared record that connects goals, brand context, and work. A fair name for the concept. Do not overuse it or unpack how it is stored. |
| Specialist | An agent that does the work against a goal or plan. Current internal roster (not public): product marketer, content, distribution, SEO discovery, lifecycle, growth. Never cite the count. |
| Approval | A person clicks before anything publishes, sends, spends, or is taken down. |
| Credits | Planned meter for usage. Not a customer-facing price list yet. |

## Brand Voice
**Tone:** Editorial, spare, confident. Early access, not launch hype.
**Style:** Short sentences. Concrete nouns (goal, website, work). Second person. No feature dump in the hero. Do not explain the internals.
**Personality:** Clear, restrained, precise, accountable.

## Proof Points
**Metrics:** None public. Do not invent conversion or ROI numbers.
**Customers:** First tenant is Branderize itself. No logo wall.
**Testimonials:** None yet.
**Value themes:**
| Theme | Proof |
|-------|-------|
| Goal stays on the work | Onboarding: write the goal, add the website, then work. |
| Shared accountability | Open the work: the goal is still there. |
| Nothing public without a person | Publish, send, and spend wait for a person. |
| Real site, not invented context | Brand Context import from a public HTTPS website; “If the source fails, nothing is invented in its place.” |

## Goals
**Business goal:** Dogfood Branderize as tenant zero; reach a truthful public self-serve launch (credits, pricing, sign-up) without promising unattended execution.
**Conversion action:** Sign in with email → create brand → write the first goal → add the website → talk to the CMO.
**Current metrics:** Early access. Public site CTA is “Sign in with email.” No published visitor, activation, or revenue numbers.

## Changelog
*Newest first. One line per revision: what changed and why.*
- v12 (2026-08-19) — Landing copy moved off architecture (shared vs private chat, provenance) onto the product: AI CMO, goal, specialists, human approval.
- v11 (2026-08-19) — Set the one-liner to “The AI CMO you can trust.” Tournament lines rejected; this is the official line.
- v10 (2026-08-19) — Replaced the one-liner with a category-and-promise line: “The AI CMO that keeps the goal on the work.”
- v9 (2026-08-19) — Rewrote the one-liner off the method list; hid the specialist count from public copy because the roster can change.
- v8 (2026-08-19) — Replaced the “Direction before the work” one-liner with the concrete method; stopped treating that phrase as positioning.
- v7 (2026-08-19) — Restored “work graph” as an allowed concept, used once; removed it from the ban list so skills do not over-avoid or overuse it.
- v6 (2026-08-19) — Rewrote architecture talk (Object, Action, work graph, provenance, Intent) into customer language so skills do not surface the implementation.
- v5 (2026-08-19) — Demoted per-user CMO chat from a value to a negligible implementation detail; recentered on goal, work graph, and provenance.
- v4 (2026-08-19) — Locked ICP to Magister’s: SaaS founders, solo marketers, and lean growth teams. Same buyers, different product.
- v3 (2026-08-19) — Filled the Magister benchmark from magistermarketing.com (autonomous agent, chat-first, credits/pricing, ICP) and tightened how Branderize differs from that category.
- v2 (2026-08-19) — Named the product Branderize; moved Magister to internal benchmark only so copy cannot treat them as the same application.
- v1 (2026-08-19) — Initial context, auto-drafted from landing, console, and architecture.
