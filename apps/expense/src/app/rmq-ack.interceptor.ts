import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { RmqContext } from '@nestjs/microservices'
import { Observable, finalize } from 'rxjs'

// Com noAck: false, o RabbitMQ só descarta a mensagem após um ack explícito;
// se o processo cair no meio do handler, a mensagem volta para a fila e é
// reentregue. O ack acontece quando o handler termina, em sucesso OU em
// qualquer erro: como o padrão é RPC, o erro vira a resposta ao chamador, e
// reencaminhar sem uma DLQ criaria loop de reentrega. Consequência assumida
// até existir DLQ: um erro transitório de infra (ex.: banco fora) descarta a
// mensagem com erro ao chamador, como já ocorria no auto-ack.
@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RmqAckInterceptor.name)

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle()

    const rmqContext = context.switchToRpc().getContext<RmqContext>()
    if (!(rmqContext instanceof RmqContext)) return next.handle()

    return next.handle().pipe(
      finalize(() => {
        try {
          rmqContext.getChannelRef().ack(rmqContext.getMessage())
        } catch (error) {
          // Canal fechado/reconectado durante o handler: o ack falha, mas o
          // broker já devolveu a mensagem à fila e vai reentregá-la.
          this.logger.warn(`Falha ao dar ack; mensagem será reentregue: ${error}`)
        }
      }),
    )
  }
}
