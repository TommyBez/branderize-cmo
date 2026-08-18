import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GATEWAY_LANGUAGE_MODEL_URL =
  'https://ai-gateway.vercel.sh/v4/ai/language-model'
const MODEL_ID = 'deepseek/deepseek-v4-pro-0813'
export const ROOT_SMOKE_PROMPT =
  'Branderize Phase 0 E2E root smoke: complete one deterministic turn.'
const HEALTH_ONLY_ROOT_AGENTS = new Set([
  'content',
  'distribution',
  'growth',
  'lifecycle',
  'seo-discovery',
])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SECOND_INTENT_STATEMENT_PATTERN = /exactly as "([^"]+)"/u
const CMO_SPECIALIST_PROMPT =
  'Use the single active Intent. Call request_specialist_work now.'
const CMO_CONSULTATION_PROMPT =
  'Consult the Product Marketer and return exactly one missing strategic question.'
const CMO_CONSULTATION_ANSWER =
  'The priority audience is product-led teams. Refine the active Intent with this answer.'
const CMO_RESOLUTION_PROMPT =
  'Resolve the attached Product Marketer question and refine its Intent.'
const CMO_SECOND_INTENT_MARKER = 'Declare a second root Intent exactly as'
const CMO_HOLD_PROMPT = 'Keep this exact turn active until I stop it.'
const BLOCKED_INTENT_MARKER = 'Mandatory blocked enterprise Intent'
const PRODUCT_MARKETER_QUESTION =
  'Which enterprise buyer must the positioning prioritize?'
const SCRIPTED_COST_USD = 0.000_004

const requestHeaders = (input, init) =>
  new Headers(
    init?.headers ??
      (typeof input === 'string' || input instanceof URL
        ? undefined
        : input.headers)
  )

const requestBody = async (input, init) => {
  if (typeof init?.body === 'string') {
    return init.body
  }
  if (typeof input === 'string' || input instanceof URL) {
    return null
  }
  return await input.clone().text()
}

const parseGatewayRequest = async (input, init) => {
  const body = await requestBody(input, init)
  if (body === null || body.length === 0) {
    throw new Error('The scripted inference provider expected JSON input')
  }
  return JSON.parse(body)
}

const messageParts = (message) =>
  Array.isArray(message?.content) ? message.content : []

const latestUserText = (prompt) => {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index]
    if (message?.role !== 'user') {
      continue
    }
    const text = messageParts(message)
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
    if (text.length > 0) {
      return text
    }
  }
  return ''
}

const currentTurnPrompt = (prompt) => {
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    if (prompt[index]?.role === 'user') {
      return prompt.slice(index)
    }
  }
  return prompt
}

const toolResults = (prompt) => {
  const results = []
  for (const message of prompt) {
    if (message?.role !== 'tool') {
      continue
    }
    for (const part of messageParts(message)) {
      if (part?.type === 'tool-result' && typeof part.toolName === 'string') {
        results.push(part)
      }
    }
  }
  return results
}

const latestToolResult = (prompt, toolName) => {
  const matchingResults = toolResults(prompt).filter(
    (result) => result.toolName === toolName
  )
  return matchingResults.at(-1) ?? null
}

const toolResultValue = (result) => {
  const output = result?.output
  if (output?.type !== 'json') {
    return null
  }
  return output.value ?? null
}

const toolCall = ({ input, name, sequence }) => ({
  input: JSON.stringify(input),
  toolCallId: `call_e2e_${sequence}_${name}`,
  toolName: name,
  type: 'tool-call',
})

const usage = () => ({
  inputTokens: {
    cacheRead: 0,
    cacheWrite: 0,
    noCache: 120,
    total: 120,
  },
  outputTokens: { reasoning: 8, text: 24, total: 32 },
})

const finish = ({ generationId, reason }) => ({
  finishReason: { raw: reason, unified: reason },
  providerMetadata: {
    gateway: {
      cost: SCRIPTED_COST_USD.toFixed(6),
      generationId,
    },
  },
  type: 'finish',
  usage: usage(),
})

const toolResponseParts = ({ generationId, input, name, sequence }) => [
  {
    id: generationId,
    modelId: MODEL_ID,
    timestamp: new Date().toISOString(),
    type: 'response-metadata',
  },
  toolCall({ input, name, sequence }),
  finish({ generationId, reason: 'tool-calls' }),
]

const textResponseParts = ({ generationId, sequence, text }) => {
  const textId = `text_e2e_${sequence}`
  return [
    {
      id: generationId,
      modelId: MODEL_ID,
      timestamp: new Date().toISOString(),
      type: 'response-metadata',
    },
    { id: textId, type: 'text-start' },
    { delta: text, id: textId, type: 'text-delta' },
    { id: textId, type: 'text-end' },
    finish({ generationId, reason: 'stop' }),
  ]
}

const gatewayOptions = (request) => request.providerOptions?.gateway ?? null

const readGatewayIdentity = (request, { rootSmokeAgent }) => {
  const options = gatewayOptions(request)
  const tags = Array.isArray(options?.tags)
    ? options.tags.filter((tag) => typeof tag === 'string')
    : []
  const user = typeof options?.user === 'string' ? options.user : null
  const laneTag = tags.find((tag) => tag.startsWith('lane:'))
  const agentTag = tags.find((tag) => tag.startsWith('agent:'))

  if (rootSmokeAgent !== null) {
    if (
      user !== null ||
      (laneTag !== undefined && laneTag !== 'lane:task') ||
      (agentTag !== undefined && agentTag !== `agent:${rootSmokeAgent}`)
    ) {
      throw new Error(
        'The scripted root smoke is restricted to its unattributed health-only root'
      )
    }
    return {
      agent: rootSmokeAgent,
      lane: 'task',
      tags,
      user: null,
    }
  }

  if (user === null || !UUID_PATTERN.test(user)) {
    throw new Error('The scripted inference provider expected a trusted brand')
  }
  if (laneTag === undefined || agentTag === undefined) {
    throw new Error('The scripted inference attribution contract changed')
  }
  return {
    agent: agentTag.slice('agent:'.length),
    lane: laneTag.slice('lane:'.length),
    tags,
    user,
  }
}

const validateRootSmokeIdentity = ({
  identity,
  isRootSmoke,
  rootSmokeAgent,
}) => {
  if (!isRootSmoke) {
    return
  }
  if (
    rootSmokeAgent === null ||
    identity.user !== null ||
    identity.lane !== 'task' ||
    identity.agent !== rootSmokeAgent
  ) {
    throw new Error(
      'The scripted root smoke is restricted to an unattributed health-only root'
    )
  }
}

const completedProductMarketerParts = ({ generationId, prompt, sequence }) => {
  const turnPrompt = currentTurnPrompt(prompt)
  const savedContext = latestToolResult(turnPrompt, 'save_brand_context')
  if (savedContext === null) {
    return toolResponseParts({
      generationId,
      input: {
        audiences: [
          {
            need: 'A trustworthy, evidence-backed positioning narrative.',
            segment: 'Product-led teams',
          },
        ],
        category: 'Evidence-backed brand operations',
        differentiators: [
          'Canonical provenance for every strategic claim',
          'Tenant-scoped specialist execution',
        ],
        risks: ['Unverified claims can weaken trust'],
        summary:
          'Branderize turns observed brand evidence into a canonical operating context.',
        valueProposition:
          'Give every marketing decision an inspectable source and accountable owner.',
      },
      name: 'save_brand_context',
      sequence,
    })
  }

  const finishedTask = latestToolResult(turnPrompt, 'finish_task')
  if (finishedTask === null) {
    return toolResponseParts({
      generationId,
      input: {
        status: 'completed',
        summary: 'Canonical Brand Context enriched from trusted evidence.',
      },
      name: 'finish_task',
      sequence,
    })
  }

  const finalOutput = latestToolResult(turnPrompt, 'final_output')
  if (finalOutput === null) {
    const completion = toolResultValue(finishedTask)
    if (completion === null) {
      throw new Error('The Product Marketer completion was not JSON')
    }
    return toolResponseParts({
      generationId,
      input: completion,
      name: 'final_output',
      sequence,
    })
  }

  return textResponseParts({
    generationId,
    sequence,
    text: 'The canonical Product Marketer task is complete.',
  })
}

const blockedProductMarketerParts = ({ generationId, prompt, sequence }) => {
  const turnPrompt = currentTurnPrompt(prompt)
  const finishedTask = latestToolResult(turnPrompt, 'finish_task')
  if (finishedTask === null) {
    return toolResponseParts({
      generationId,
      input: {
        openQuestions: [PRODUCT_MARKETER_QUESTION],
        reason: 'missing_human_context',
        status: 'blocked',
        summary: 'Enterprise positioning needs one human audience decision.',
      },
      name: 'finish_task',
      sequence,
    })
  }

  if (latestToolResult(turnPrompt, 'final_output') === null) {
    const completion = toolResultValue(finishedTask)
    if (completion === null) {
      throw new Error('The blocked Product Marketer completion was not JSON')
    }
    return toolResponseParts({
      generationId,
      input: completion,
      name: 'final_output',
      sequence,
    })
  }

  return textResponseParts({
    generationId,
    sequence,
    text: 'The Product Marketer task is blocked on one human answer.',
  })
}

const secondIntentStatement = (userText) => {
  const markerIndex = userText.indexOf(CMO_SECOND_INTENT_MARKER)
  if (markerIndex < 0) {
    return null
  }
  const statement = userText
    .slice(markerIndex)
    .match(SECOND_INTENT_STATEMENT_PATTERN)?.[1]
  if (statement === undefined || statement.trim().length === 0) {
    throw new Error('The scripted second Intent statement is missing')
  }
  return statement.trim()
}

const consultationCmoParts = ({ generationId, prompt, sequence }) => {
  const turnPrompt = currentTurnPrompt(prompt)
  if (latestToolResult(turnPrompt, 'product-marketer') === null) {
    return toolResponseParts({
      generationId,
      input: {
        message:
          'Review the current positioning objective and return exactly one missing strategic question.',
      },
      name: 'product-marketer',
      sequence,
    })
  }
  return textResponseParts({
    generationId,
    sequence,
    text: `Product Marketer asks: ${PRODUCT_MARKETER_QUESTION}`,
  })
}

const consultationAnswerParts = ({ generationId, prompt, sequence }) => {
  const turnPrompt = currentTurnPrompt(prompt)
  if (latestToolResult(turnPrompt, 'refine_intent') === null) {
    return toolResponseParts({
      generationId,
      input: {
        acceptanceCriteria: [
          'Positioning explicitly prioritizes product-led teams.',
        ],
        constraints: null,
      },
      name: 'refine_intent',
      sequence,
    })
  }
  return textResponseParts({
    generationId,
    sequence,
    text: 'The active Intent now records the unambiguous audience answer.',
  })
}

const secondIntentParts = ({ generationId, prompt, sequence, statement }) => {
  const turnPrompt = currentTurnPrompt(prompt)
  const declarationResults = toolResults(turnPrompt).filter(
    (result) => result.toolName === 'declare_intent'
  )
  const declarationCount = declarationResults.length
  if (declarationCount < 2) {
    return toolResponseParts({
      generationId,
      input: {
        acceptanceCriteria: [
          'Name the enterprise buyer and preserve evidence for every claim.',
        ],
        constraints: null,
        statement,
      },
      name: 'declare_intent',
      sequence,
    })
  }
  const firstReceipt = toolResultValue(declarationResults[0])
  const replayReceipt = toolResultValue(declarationResults[1])
  if (JSON.stringify(firstReceipt) !== JSON.stringify(replayReceipt)) {
    throw new Error('Repeated Intent declaration did not return its receipt')
  }
  if (latestToolResult(turnPrompt, 'request_specialist_work') === null) {
    return toolResponseParts({
      generationId,
      input: {},
      name: 'request_specialist_work',
      sequence,
    })
  }
  return textResponseParts({
    generationId,
    sequence,
    text: 'The second root Intent and its Product Marketer work are canonical.',
  })
}

const taskResolutionParts = ({ generationId, prompt, sequence }) => {
  const turnPrompt = currentTurnPrompt(prompt)
  if (
    latestToolResult(turnPrompt, 'resolve_product_marketer_questions') === null
  ) {
    return toolResponseParts({
      generationId,
      input: {
        disposition: 'answered',
        rationale:
          'The human identified enterprise product leaders at growth-stage SaaS.',
      },
      name: 'resolve_product_marketer_questions',
      sequence,
    })
  }
  if (latestToolResult(turnPrompt, 'refine_intent') === null) {
    return toolResponseParts({
      generationId,
      input: {
        acceptanceCriteria: [
          'Prioritize enterprise product leaders at growth-stage SaaS.',
        ],
        constraints: null,
      },
      name: 'refine_intent',
      sequence,
    })
  }
  return textResponseParts({
    generationId,
    sequence,
    text: 'The question bundle is resolved and its Intent is refined.',
  })
}

const cmoParts = ({ generationId, prompt, sequence }) => {
  const userText = latestUserText(prompt)
  if (userText.includes(CMO_CONSULTATION_PROMPT)) {
    return consultationCmoParts({ generationId, prompt, sequence })
  }
  if (userText.includes(CMO_CONSULTATION_ANSWER)) {
    return consultationAnswerParts({ generationId, prompt, sequence })
  }
  const statement = secondIntentStatement(userText)
  if (statement !== null) {
    return secondIntentParts({
      generationId,
      prompt,
      sequence,
      statement,
    })
  }
  if (userText.includes(CMO_RESOLUTION_PROMPT)) {
    return taskResolutionParts({ generationId, prompt, sequence })
  }
  if (userText.includes(CMO_SPECIALIST_PROMPT)) {
    const turnPrompt = currentTurnPrompt(prompt)
    if (latestToolResult(turnPrompt, 'request_specialist_work') !== null) {
      return textResponseParts({
        generationId,
        sequence,
        text: 'Product Marketer work was requested from the trusted Intent.',
      })
    }
    return toolResponseParts({
      generationId,
      input: {},
      name: 'request_specialist_work',
      sequence,
    })
  }
  throw new Error(`No scripted CMO inference matched: ${userText}`)
}

const inferenceParts = ({
  generationId,
  identity,
  request,
  rootSmoke,
  sequence,
}) => {
  const prompt = Array.isArray(request.prompt) ? request.prompt : []
  if (rootSmoke) {
    return textResponseParts({
      generationId,
      sequence,
      text: `The ${identity.agent} Phase 0 root completed its deterministic smoke turn.`,
    })
  }
  if (identity.lane === 'cmo' && identity.agent === 'cmo') {
    return cmoParts({ generationId, prompt, sequence })
  }
  if (identity.lane === 'task' && identity.agent === 'product-marketer') {
    if (latestUserText(prompt).includes(BLOCKED_INTENT_MARKER)) {
      return blockedProductMarketerParts({ generationId, prompt, sequence })
    }
    return completedProductMarketerParts({ generationId, prompt, sequence })
  }
  if (
    identity.lane === 'consultation' &&
    identity.agent === 'product-marketer'
  ) {
    return textResponseParts({
      generationId,
      sequence,
      text: PRODUCT_MARKETER_QUESTION,
    })
  }
  throw new Error(
    `No scripted inference exists for ${identity.agent}/${identity.lane}`
  )
}

const eventStreamResponse = (parts) =>
  new Response(
    `${parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' }, status: 200 }
  )

const heldEventStreamResponse = ({ generationId, sequence, signal }) => {
  const encoder = new TextEncoder()
  const textId = `text_e2e_${sequence}`
  const initialParts = [
    {
      id: generationId,
      modelId: MODEL_ID,
      timestamp: new Date().toISOString(),
      type: 'response-metadata',
    },
    { id: textId, type: 'text-start' },
    {
      delta: 'This turn is active and can be stopped only by its owner.',
      id: textId,
      type: 'text-delta',
    },
  ]
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            initialParts
              .map((part) => `data: ${JSON.stringify(part)}\n\n`)
              .join('')
          )
        )
        signal?.addEventListener('abort', () => controller.close(), {
          once: true,
        })
      },
    }),
    { headers: { 'content-type': 'text/event-stream' }, status: 200 }
  )
}

export const createScriptedInferenceProvider = ({
  providerStateDirectory,
  rootAgent = null,
}) => {
  if (rootAgent !== null && !HEALTH_ONLY_ROOT_AGENTS.has(rootAgent)) {
    throw new Error('The scripted root identity is not a health-only root')
  }
  let sequence = 0

  return async ({ init, input, url }) => {
    if (url.toString() !== GATEWAY_LANGUAGE_MODEL_URL) {
      return null
    }
    sequence += 1
    const headers = requestHeaders(input, init)
    if (
      headers.get('authorization') !==
        `Bearer ${process.env.AI_GATEWAY_API_KEY}` ||
      headers.get('ai-language-model-id') !== MODEL_ID ||
      headers.get('ai-language-model-streaming') !== 'true' ||
      headers.get('ai-language-model-specification-version') !== '4'
    ) {
      throw new Error('The scripted AI Gateway transport contract changed')
    }

    const request = await parseGatewayRequest(input, init)
    const prompt = Array.isArray(request.prompt) ? request.prompt : []
    const isRootSmoke = latestUserText(prompt) === ROOT_SMOKE_PROMPT
    const rootSmokeAgent = isRootSmoke ? rootAgent : null
    const identity = readGatewayIdentity(request, {
      rootSmokeAgent,
    })
    validateRootSmokeIdentity({ identity, isRootSmoke, rootSmokeAgent })
    const generationId = `generation_e2e_${process.pid}_${sequence}`
    const isHeldTurn =
      identity.agent === 'cmo' &&
      identity.lane === 'cmo' &&
      latestUserText(prompt).includes(CMO_HOLD_PROMPT)
    const parts = isHeldTurn
      ? []
      : inferenceParts({
          generationId,
          identity,
          request,
          rootSmoke: isRootSmoke,
          sequence,
        })
    writeFileSync(
      resolve(
        providerStateDirectory,
        `gateway-${process.pid}-${String(sequence).padStart(4, '0')}.json`
      ),
      JSON.stringify({
        agent: identity.agent,
        costUsd: SCRIPTED_COST_USD,
        generationId,
        lane: identity.lane,
        latestUserTextSha256: createHash('sha256')
          .update(
            latestUserText(Array.isArray(request.prompt) ? request.prompt : [])
          )
          .digest('hex'),
        modelId: headers.get('ai-language-model-id'),
        providerOptions: gatewayOptions(request),
        responseTypes: parts.map((part) => part.type),
        sequence,
        toolNames: Array.isArray(request.tools)
          ? request.tools.map((tool) => tool.name)
          : [],
      })
    )
    if (isHeldTurn) {
      return heldEventStreamResponse({
        generationId,
        sequence,
        signal: init?.signal,
      })
    }
    return eventStreamResponse(parts)
  }
}
