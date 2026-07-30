import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

function createAdapter(): PrismaPg {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required')
  }

  return new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5000,
  })
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor() {
    super({ adapter: createAdapter() })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
