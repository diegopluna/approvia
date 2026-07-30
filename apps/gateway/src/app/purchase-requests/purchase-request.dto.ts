import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'
import { Transform } from 'class-transformer'

export class CreatePurchaseRequestDto {
  @IsString()
  @Length(3, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/, {
    message: 'amount must be a positive BRL amount with at most two decimals',
  })
  amount!: string

  @IsString()
  @Length(5, 1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  justification!: string
}

export class DecidePurchaseRequestDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED'

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  comment?: string
}
