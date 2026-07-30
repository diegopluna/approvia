import 'reflect-metadata'
import {
  INestApplication,
  INestMicroservice,
  ValidationPipe,
} from '@nestjs/common'
import { MicroserviceOptions, Transport } from '@nestjs/microservices'
import { Test } from '@nestjs/testing'
import { generateKeyPairSync, KeyObject, randomUUID } from 'node:crypto'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { sign } from 'jsonwebtoken'
import { vi } from 'vitest'
// The integration suite intentionally boots the application in-process.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AppModule } from '../../../gateway/src/app/app.module'
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ExpenseModule } from '../../../expense/src/app/expense.module'
// eslint-disable-next-line @nx/enforce-module-boundaries
import { PrismaService } from '../../../expense/src/app/prisma.service'
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  PurchaseRequest,
  PurchaseRequestStatus,
} from '../../../expense/src/generated/prisma/client'

const KEY_ID = 'gateway-e2e-key'
const REALM = 'test-realm'
const AUDIENCE = 'gateway'

describe('GET /api/me authentication', () => {
  let app: INestApplication
  let expenseApp: INestMicroservice
  let jwksServer: Server
  let privateKey: KeyObject
  let issuer: string
  let apiBaseUrl: string
  const purchaseRequests: PurchaseRequest[] = []

  const prisma = {
    purchaseRequest: {
      create: vi.fn(
        ({ data }: { data: Partial<PurchaseRequest> }) => {
          const request: PurchaseRequest = {
            id: randomUUID(),
            title: data.title ?? '',
            justification: data.justification ?? '',
            amountMinor: data.amountMinor ?? 0,
            currency: data.currency ?? 'BRL',
            status: data.status ?? PurchaseRequestStatus.PENDING,
            requesterId: data.requesterId ?? '',
            requesterName: data.requesterName ?? '',
            createdAt: new Date(),
            decidedById: null,
            decidedByName: null,
            decisionComment: null,
            decidedAt: null,
          }
          purchaseRequests.push(request)
          return request
        },
      ),
      findMany: vi.fn(
        ({ where }: { where: Record<string, unknown> }) =>
          purchaseRequests
            .filter((request) => {
              if (
                typeof where['requesterId'] === 'string' &&
                request.requesterId !== where['requesterId']
              ) {
                return false
              }
              const requesterFilter = where['requesterId']
              if (
                typeof requesterFilter === 'object' &&
                requesterFilter !== null &&
                'not' in requesterFilter &&
                request.requesterId === requesterFilter.not
              ) {
                return false
              }
              if (
                typeof where['decidedById'] === 'string' &&
                request.decidedById !== where['decidedById']
              ) {
                return false
              }
              return !where['status'] || request.status === where['status']
            })
            .sort((left, right) =>
              typeof where['requesterId'] === 'string'
                ? right.createdAt.getTime() - left.createdAt.getTime()
                : left.createdAt.getTime() - right.createdAt.getTime(),
            ),
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        purchaseRequests.find((request) => request.id === where.id),
      ),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; status: PurchaseRequestStatus }
          data: Partial<PurchaseRequest>
        }) => {
          const request = purchaseRequests.find(
            (item) => item.id === where.id && item.status === where.status,
          )
          if (!request) return { count: 0 }
          Object.assign(request, data)
          return { count: 1 }
        },
      ),
      findUniqueOrThrow: vi.fn(({ where }: { where: { id: string } }) => {
        const request = purchaseRequests.find((item) => item.id === where.id)
        if (!request) throw new Error('Not found')
        return request
      }),
    },
  }

  beforeAll(async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    privateKey = keyPair.privateKey
    const publicJwk = keyPair.publicKey.export({ format: 'jwk' })

    jwksServer = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          keys: [{ ...publicJwk, kid: KEY_ID, use: 'sig', alg: 'RS256' }],
        }),
      )
    })
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, '127.0.0.1', resolve),
    )

    const jwksAddress = jwksServer.address() as AddressInfo
    const keycloakBaseUrl = `http://127.0.0.1:${jwksAddress.port}`
    issuer = `${keycloakBaseUrl}/realms/${REALM}`
    process.env.KEYCLOAK_BASE_URL = keycloakBaseUrl
    process.env.KEYCLOAK_REALM = REALM
    process.env.KEYCLOAK_AUDIENCE = AUDIENCE
    process.env.KEYCLOAK_REQUIRED_ROLE = 'user'

    const portReservation = createServer()
    await new Promise<void>((resolve) =>
      portReservation.listen(0, '127.0.0.1', resolve),
    )
    const expensePort = (portReservation.address() as AddressInfo).port
    await new Promise<void>((resolve, reject) =>
      portReservation.close((error) => (error ? reject(error) : resolve())),
    )
    process.env.EXPENSE_SERVICE_HOST = '127.0.0.1'
    process.env.EXPENSE_SERVICE_PORT = String(expensePort)

    const expenseModuleRef = await Test.createTestingModule({
      imports: [ExpenseModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile()
    expenseApp = expenseModuleRef.createNestMicroservice<MicroserviceOptions>({
      transport: Transport.TCP,
      options: { host: '127.0.0.1', port: expensePort },
    })
    await expenseApp.listen()

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    await app.listen(0, '127.0.0.1')

    const apiAddress = app.getHttpServer().address() as AddressInfo
    apiBaseUrl = `http://127.0.0.1:${apiAddress.port}/api`
  })

  afterAll(async () => {
    await app.close()
    await expenseApp.close()
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error ? reject(error) : resolve())),
    )
  })

  it('accepts a valid access token with the required role', async () => {
    const response = await request(token())

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      sub: 'test-user',
      realm_access: { roles: ['user'] },
    })
  })

  it('rejects a request without a token', async () => {
    expect((await request()).status).toBe(401)
  })

  it('rejects an expired token', async () => {
    expect((await request(token({ expiresIn: -10 }))).status).toBe(401)
  })

  it('rejects a token from another issuer', async () => {
    expect(
      (await request(token({ issuer: 'https://issuer.invalid/realms/test' })))
        .status,
    ).toBe(401)
  })

  it('rejects a token for another audience', async () => {
    expect((await request(token({ audience: 'another-api' }))).status).toBe(401)
  })

  it('rejects a token with an invalid signature', async () => {
    const otherKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    }).privateKey
    expect((await request(token({ key: otherKey }))).status).toBe(401)
  })

  it('forbids a valid token without the required role', async () => {
    expect((await request(token({ roles: ['viewer'] }))).status).toBe(403)
  })

  it('completes the purchase request approval workflow', async () => {
    purchaseRequests.length = 0
    const requesterToken = token({
      subject: 'requester-id',
      name: 'Test Requester',
    })
    const approverToken = token({
      subject: 'approver-id',
      name: 'Alex Approver',
      roles: ['user', 'approver'],
    })

    const createResponse = await request(
      requesterToken,
      'purchase-requests',
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Replacement monitor',
          amount: '1499.90',
          justification: 'The current monitor has stopped working.',
        }),
      },
    )
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { id: string }

    const mineResponse = await request(
      requesterToken,
      'purchase-requests/mine',
    )
    expect(await mineResponse.json()).toMatchObject([
      {
        id: created.id,
        amount: '1499.90',
        currency: 'BRL',
        status: 'PENDING',
      },
    ])

    expect(
      (await request(requesterToken, 'purchase-requests/pending')).status,
    ).toBe(403)
    expect(
      (await request(approverToken, 'purchase-requests/mine')).status,
    ).toBe(403)
    expect(
      (
        await request(approverToken, 'purchase-requests', {
          method: 'POST',
          body: JSON.stringify({
            title: 'Approver request',
            amount: '10.00',
            justification: 'This must not be created.',
          }),
        })
      ).status,
    ).toBe(403)

    const pendingResponse = await request(
      approverToken,
      'purchase-requests/pending',
    )
    expect(await pendingResponse.json()).toMatchObject([
      { id: created.id, requesterName: 'Test Requester' },
    ])

    const selfDecision = await request(
      token({
        subject: 'requester-id',
        roles: ['user', 'approver'],
      }),
      `purchase-requests/${created.id}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      },
    )
    expect(selfDecision.status).toBe(403)

    const decisionResponse = await request(
      approverToken,
      `purchase-requests/${created.id}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'APPROVED' }),
      },
    )
    expect(decisionResponse.status).toBe(201)
    expect(await decisionResponse.json()).toMatchObject({
      status: 'APPROVED',
      decidedByName: 'Alex Approver',
    })

    const duplicateDecision = await request(
      approverToken,
      `purchase-requests/${created.id}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'REJECTED', comment: 'Too late' }),
      },
    )
    expect(duplicateDecision.status).toBe(409)

    const decidedMineResponse = await request(
      requesterToken,
      'purchase-requests/mine',
    )
    expect(await decidedMineResponse.json()).toMatchObject([
      { id: created.id, status: 'APPROVED' },
    ])

    const approvedResponse = await request(
      approverToken,
      'purchase-requests/approved',
    )
    expect(await approvedResponse.json()).toMatchObject([
      { id: created.id, status: 'APPROVED' },
    ])

    const emptyPendingResponse = await request(
      approverToken,
      'purchase-requests/pending',
    )
    expect(await emptyPendingResponse.json()).toEqual([])
  })

  it('requires a comment when rejecting a request', async () => {
    purchaseRequests.length = 0
    const requesterToken = token({ subject: 'another-requester' })
    const approverToken = token({
      subject: 'approver-id',
      roles: ['user', 'approver'],
    })
    const createResponse = await request(
      requesterToken,
      'purchase-requests',
      {
        method: 'POST',
        body: JSON.stringify({
          title: 'Office chair',
          amount: '800',
          justification: 'The current chair is broken.',
        }),
      },
    )
    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as { id: string }

    const response = await request(
      approverToken,
      `purchase-requests/${created.id}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'REJECTED' }),
      },
    )
    expect(response.status).toBe(400)
  })

  function request(
    accessToken?: string,
    path = 'me',
    init: RequestInit = {},
  ): Promise<Response> {
    return fetch(`${apiBaseUrl}/${path}`, {
      ...init,
      headers: {
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  }

  function token(
    overrides: {
      audience?: string
      expiresIn?: number
      issuer?: string
      key?: KeyObject
      name?: string
      roles?: string[]
      subject?: string
    } = {},
  ): string {
    return sign(
      {
        sub: overrides.subject ?? 'test-user',
        name: overrides.name,
        realm_access: { roles: overrides.roles ?? ['user'] },
      },
      overrides.key ?? privateKey,
      {
        algorithm: 'RS256',
        audience: overrides.audience ?? AUDIENCE,
        expiresIn: overrides.expiresIn ?? 300,
        issuer: overrides.issuer ?? issuer,
        keyid: KEY_ID,
      },
    )
  }
})
