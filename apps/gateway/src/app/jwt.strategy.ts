import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { passportJwtSecret } from 'jwks-rsa'
import { ExtractJwt, Strategy } from 'passport-jwt'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const baseUrl = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:8080'
    const realm = process.env.KEYCLOAK_REALM ?? 'approvia'
    const audience = process.env.KEYCLOAK_AUDIENCE ?? 'gateway'
    const issuer = `${baseUrl}/realms/${realm}`

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: passportJwtSecret({
        jwksUri: `${issuer}/protocol/openid-connect/certs`,
        cache: true,
        rateLimit: true,
      }),
      issuer,
      audience,
      algorithms: ['RS256'],
    })
  }

  validate(payload: Record<string, unknown>) {
    return payload
  }
}
