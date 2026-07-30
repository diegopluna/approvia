import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApproverRoleGuard } from '../approver-role.guard'
import { RealmRoleGuard } from '../realm-role.guard'
import { RequesterRoleGuard } from '../requester-role.guard'
import {
  CreatePurchaseRequestDto,
  DecidePurchaseRequestDto,
} from './purchase-request.dto'
import { PurchaseRequestsService } from './purchase-requests.service'

type AuthenticatedRequest = {
  user: Record<string, unknown>
}

@Controller('purchase-requests')
@UseGuards(AuthGuard('jwt'), RealmRoleGuard)
export class PurchaseRequestsController {
  constructor(
    @Inject(PurchaseRequestsService)
    private readonly purchaseRequests: PurchaseRequestsService,
  ) {}

  @Post()
  @UseGuards(RequesterRoleGuard)
  create(
    @Request() request: AuthenticatedRequest,
    @Body() input: CreatePurchaseRequestDto,
  ) {
    return this.purchaseRequests.create(request.user, input)
  }

  @Get('mine')
  @UseGuards(RequesterRoleGuard)
  mine(@Request() request: AuthenticatedRequest) {
    return this.purchaseRequests.mine(request.user)
  }

  @Get('pending')
  @UseGuards(ApproverRoleGuard)
  pending(@Request() request: AuthenticatedRequest) {
    return this.purchaseRequests.pending(request.user)
  }

  @Get('approved')
  @UseGuards(ApproverRoleGuard)
  approved(@Request() request: AuthenticatedRequest) {
    return this.purchaseRequests.approved(request.user)
  }

  @Post(':id/decision')
  @UseGuards(ApproverRoleGuard)
  decide(
    @Request() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: DecidePurchaseRequestDto,
  ) {
    return this.purchaseRequests.decide(request.user, id, input)
  }
}
