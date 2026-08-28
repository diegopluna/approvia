import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common'
import { NativeConnection, Worker } from '@temporalio/worker'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ExpenseService } from '../expense.service'
import { createApprovalActivities } from './activities'
import {
  APPROVAL_TASK_QUEUE,
  temporalAddress,
  temporalNamespace,
  workflowsEnabled,
} from './workflow.config'

const RECONNECT_DELAY_MS = 5000

@Injectable()
export class WorkflowWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowWorker.name)
  private connection: NativeConnection | null = null
  private worker: Worker | null = null
  private runPromise: Promise<void> | null = null
  private stopping = false

  constructor(private readonly expenseService: ExpenseService) {}

  onApplicationBootstrap() {
    if (!workflowsEnabled()) return
    // Inicialização em segundo plano com retentativas: o serviço de despesas
    // continua atendendo comandos mesmo com o Temporal temporariamente fora.
    void this.startWithRetry()
  }

  async onModuleDestroy() {
    this.stopping = true
    if (this.worker) {
      this.worker.shutdown()
      await this.runPromise?.catch(() => undefined)
    }
    await this.connection?.close().catch(() => undefined)
  }

  private async startWithRetry() {
    while (!this.stopping) {
      try {
        this.connection = await NativeConnection.connect({
          address: temporalAddress(),
        })
        this.worker = await Worker.create({
          connection: this.connection,
          namespace: temporalNamespace(),
          taskQueue: APPROVAL_TASK_QUEUE,
          workflowsPath: resolveWorkflowsPath(),
          activities: createApprovalActivities(this.expenseService),
        })
        this.logger.log(
          `Temporal worker started on task queue ${APPROVAL_TASK_QUEUE}`,
        )
        this.runPromise = this.worker.run()
        await this.runPromise
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Temporal worker unavailable: ${message}`)
        await this.connection?.close().catch(() => undefined)
        this.connection = null
        this.worker = null
        if (this.stopping) return
        await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS))
      }
    }
  }
}

function resolveWorkflowsPath(): string {
  if (process.env.TEMPORAL_WORKFLOWS_PATH) {
    return process.env.TEMPORAL_WORKFLOWS_PATH
  }
  const candidates = [
    // Execução empacotada (webpack): a fonte TS fica disponível no repositório.
    join(
      process.cwd(),
      'apps/expense/src/app/workflows/approval.workflow.ts',
    ),
    join(__dirname, 'approval.workflow.ts'),
    join(__dirname, 'approval.workflow.js'),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(
      'Workflow source not found; set TEMPORAL_WORKFLOWS_PATH to approval.workflow.ts',
    )
  }
  return found
}
