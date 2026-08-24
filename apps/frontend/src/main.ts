import { bootstrapApplication } from '@angular/platform-browser'
import { appConfig } from './app/app.config'
import { App } from './app/app'

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  console.error('Approvia failed to start', error)

  const root = document.querySelector('app-root')
  if (!root) return

  root.innerHTML = `
    <main class="startup-error" role="alert">
      <section class="startup-error__card">
        <h1>Não foi possível iniciar o Approvia</h1>
        <p>
          O serviço de autenticação não está disponível. Inicie a infraestrutura
          local e recarregue a página.
        </p>
        <code>docker compose -f infra/docker-compose.yml up -d --wait</code>
        <a href="/">Tentar novamente</a>
      </section>
    </main>
  `
})
