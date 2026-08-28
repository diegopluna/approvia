import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { WorkflowHandle } from '@temporalio/client'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const TASK_QUEUE = 'approval-lifecycle-test'
const WORKFLOWS_PATH = fileURLToPath(
  new URL('./approval.workflow.ts', import.meta.url),
)

const HOUR = 3_600_000

describe('approvalWorkflow', () => {
  let env: TestWorkflowEnvironment

  // Ambiente novo por teste: o time-skipping fica destravado após aguardar
  // um resultado, o que tornaria os sleeps dos testes seguintes indeterminados.
  beforeEach(async () => {
    env = await TestWorkflowEnvironment.createTimeSkipping()
  })

  afterEach(async () => {
    await env?.teardown()
  })

  type Activities = {
    sendReminder: ReturnType<typeof vi.fn>
    expireRequest: ReturnType<typeof vi.fn>
  }

  function activities(): Activities {
    return {
      sendReminder: vi.fn(async () => undefined),
      expireRequest: vi.fn(async () => undefined),
    }
  }

  async function withWorkflow(
    input: {
      reminderDelayMs: number
      reminderIntervalMs: number
      deadlineInMs: number
    },
    mocks: Activities,
    scenario: (handle: WorkflowHandle) => Promise<void>,
  ) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace,
      taskQueue: TASK_QUEUE,
      workflowsPath: WORKFLOWS_PATH,
      activities: mocks,
    })
    await worker.runUntil(async () => {
      const requestId = randomUUID()
      const handle = await env.client.workflow.start('approvalWorkflow', {
        workflowId: `approval-${requestId}`,
        taskQueue: TASK_QUEUE,
        args: [
          {
            requestId,
            decisionDeadlineAt: new Date(
              Date.now() + input.deadlineInMs,
            ).toISOString(),
            reminderDelayMs: input.reminderDelayMs,
            reminderIntervalMs: input.reminderIntervalMs,
          },
        ],
      })
      await scenario(handle)
    })
  }

  it('fires reminders on the configured cadence with increasing occurrences', async () => {
    const mocks = activities()
    await withWorkflow(
      { reminderDelayMs: HOUR, reminderIntervalMs: HOUR, deadlineInMs: 100 * HOUR },
      mocks,
      async (handle) => {
        await env.sleep(3.5 * HOUR)
        await handle.signal('decided')
        await handle.result()
      },
    )

    const occurrences = mocks.sendReminder.mock.calls.map(([, n]) => n)
    expect(occurrences).toEqual([1, 2, 3])
    expect(mocks.expireRequest).not.toHaveBeenCalled()
  })

  it('sends no reminder when decided before the first delay elapses', async () => {
    const mocks = activities()
    await withWorkflow(
      { reminderDelayMs: HOUR, reminderIntervalMs: HOUR, deadlineInMs: 100 * HOUR },
      mocks,
      async (handle) => {
        await env.sleep(HOUR / 2)
        await handle.signal('decided')
        await handle.result()
      },
    )

    expect(mocks.sendReminder).not.toHaveBeenCalled()
    expect(mocks.expireRequest).not.toHaveBeenCalled()
  })

  it('expires exactly once at the deadline and never reminds past it', async () => {
    const mocks = activities()
    await withWorkflow(
      { reminderDelayMs: HOUR, reminderIntervalMs: HOUR, deadlineInMs: 1.5 * HOUR },
      mocks,
      async (handle) => {
        await env.sleep(1.2 * HOUR)
        await handle.result()
      },
    )

    expect(mocks.sendReminder.mock.calls.map(([, n]) => n)).toEqual([1])
    expect(mocks.expireRequest).toHaveBeenCalledTimes(1)
  })

  it('never expires when decided before the deadline', async () => {
    const mocks = activities()
    await withWorkflow(
      { reminderDelayMs: 10 * HOUR, reminderIntervalMs: HOUR, deadlineInMs: 2 * HOUR },
      mocks,
      async (handle) => {
        await env.sleep(1.9 * HOUR)
        await handle.signal('decided')
        await handle.result()
      },
    )

    expect(mocks.expireRequest).not.toHaveBeenCalled()
    expect(mocks.sendReminder).not.toHaveBeenCalled()
  })
})
