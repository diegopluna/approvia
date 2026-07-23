import 'reflect-metadata'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { generateKeyPairSync, KeyObject } from 'node:crypto'
import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { sign } from 'jsonwebtoken'
// The integration suite intentionally boots the application in-process.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AppModule } from '../../../gateway/src/app/app.module'

const KEY_ID = 'gateway-e2e-key'
const REALM = 'test-realm'
const AUDIENCE = 'gateway'

describe('GET /api/me authentication', () => {
  let app: INestApplication
  let jwksServer: Server
  let privateKey: KeyObject
  let issuer: string
  let apiUrl: string

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

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    await app.listen(0, '127.0.0.1')

    const apiAddress = app.getHttpServer().address() as AddressInfo
    apiUrl = `http://127.0.0.1:${apiAddress.port}/api/me`
  })

  afterAll(async () => {
    await app.close()
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

  function request(accessToken?: string): Promise<Response> {
    return fetch(apiUrl, {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
    })
  }

  function token(
    overrides: {
      audience?: string
      expiresIn?: number
      issuer?: string
      key?: KeyObject
      roles?: string[]
    } = {},
  ): string {
    return sign(
      {
        sub: 'test-user',
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
