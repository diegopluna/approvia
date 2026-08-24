import { Injectable } from '@nestjs/common'
import { EXPENSE_EVENT_NAMES, ExpenseIntegrationEvent } from '@approvia/events'

export type RenderedEmail = {
  template: string
  templateVersion: number
  subject: string
  html: string
  text: string
  data: Record<string, unknown>
}

@Injectable()
export class EmailTemplateService {
  render(event: ExpenseIntegrationEvent): RenderedEmail {
    const request = event.data.request
    const amount = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: request.currency,
    }).format(request.amountMinor / 100)
    const requestUrl = `${process.env.FRONTEND_URL ?? 'http://localhost:4200'}`

    if (event.eventName === EXPENSE_EVENT_NAMES.created) {
      const subject = `Nova solicitação: ${request.title}`
      const text = [
        'Uma nova solicitação aguarda aprovação.',
        `Solicitante: ${request.requesterName}`,
        `Título: ${request.title}`,
        `Valor: ${amount}`,
        `Acessar: ${requestUrl}`,
      ].join('\n')
      return {
        template: 'expense-request-created',
        templateVersion: 1,
        subject,
        text,
        html: this.layout(
          subject,
          `<p>Uma nova solicitação aguarda aprovação.</p>
           <p><strong>Solicitante:</strong> ${escapeHtml(request.requesterName)}<br>
           <strong>Título:</strong> ${escapeHtml(request.title)}<br>
           <strong>Valor:</strong> ${escapeHtml(amount)}</p>
           <p><a href="${escapeHtml(requestUrl)}">Acessar o Approvia</a></p>`,
        ),
        data: { request, amount },
      }
    }

    const approved = event.eventName === EXPENSE_EVENT_NAMES.approved
    const statusLabel = approved ? 'aprovada' : 'rejeitada'
    const subject = `Sua solicitação foi ${statusLabel}: ${request.title}`
    const decision = event.data.decision
    const comment = decision.comment ? `\nComentário: ${decision.comment}` : ''
    const text = [
      `Olá, ${request.requesterName}.`,
      `Sua solicitação "${request.title}" foi ${statusLabel}.`,
      `Valor: ${amount}`,
      `Decidida por: ${decision.decidedByName}${comment}`,
      `Acessar: ${requestUrl}`,
    ].join('\n')

    return {
      template: approved
        ? 'expense-request-approved'
        : 'expense-request-rejected',
      templateVersion: 1,
      subject,
      text,
      html: this.layout(
        subject,
        `<p>Olá, ${escapeHtml(request.requesterName)}.</p>
         <p>Sua solicitação <strong>${escapeHtml(request.title)}</strong> foi ${statusLabel}.</p>
         <p><strong>Valor:</strong> ${escapeHtml(amount)}<br>
         <strong>Decidida por:</strong> ${escapeHtml(decision.decidedByName)}</p>
         ${decision.comment ? `<p><strong>Comentário:</strong> ${escapeHtml(decision.comment)}</p>` : ''}
         <p><a href="${escapeHtml(requestUrl)}">Acessar o Approvia</a></p>`,
      ),
      data: { request, decision, amount },
    }
  }

  private layout(title: string, content: string): string {
    return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
    <main style="max-width:600px;margin:0 auto;padding:24px">
      <h1 style="font-size:22px">${escapeHtml(title)}</h1>
      ${content}
    </main>
  </body>
</html>`
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character,
  )
}
