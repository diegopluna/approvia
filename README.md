# Approvia

## Local development

Install dependencies, start PostgreSQL, Keycloak, and RabbitMQ, then apply the
database migration:

```sh
pnpm install
docker compose -f infra/docker-compose.yml up -d --wait
pnpm expense:db:migrate
```

Start the expense microservice, gateway, and frontend in separate terminals:

```sh
pnpm dev:expense
pnpm dev:gateway
pnpm dev:frontend
```

Open `http://localhost:4200`. Two development accounts are available:

| Account                 | Password      | Access                                               |
| ----------------------- | ------------- | ---------------------------------------------------- |
| `test@approvia.dev`     | `password123` | Submit and track requests                            |
| `approver@approvia.dev` | `password123` | Approve or reject requests and view approval history |

Purchase amounts are stored in centavos and displayed in BRL. Requests have a
single decision step: pending, approved, or rejected. Approvers cannot create
requests, and rejections require a comment.

The gateway owns HTTP authentication and role authorization. It forwards
purchase-request commands over a durable RabbitMQ queue to the `expense`
microservice. The expense service owns the Prisma persistence and approval
business rules. RabbitMQ management is available at `http://localhost:15672`
with the local `approvia` / `approvia` credentials.

If port `5433` is already used, choose another host port and use the same port
in the expense service database URL:

```sh
DATABASE_PORT=5434 docker compose -f infra/docker-compose.yml up -d database
DATABASE_URL=postgresql://approvia:approvia@localhost:5434/approvia?schema=public pnpm expense:db:deploy
DATABASE_URL=postgresql://approvia:approvia@localhost:5434/approvia?schema=public pnpm dev:expense
```

The frontend uses Authorization Code flow with PKCE. Keycloak tokens are kept in
memory, refreshed by `keycloak-js`, and sent only to same-origin `/api` requests.
The gateway verifies the signature, issuer, `gateway` audience, expiration, and
the required `user` realm role.

Run the frontend, gateway, and expense workflow suites with:

```sh
pnpm test:all
```

The proposed asynchronous email architecture and rollout are documented in
[`docs/notifications.md`](docs/notifications.md).

## Deployment authentication

`apps/frontend/public/auth-config.json` is runtime configuration. Replace that
file when deploying the built frontend; a rebuild is not required:

```json
{
  "url": "https://identity.example.com",
  "realm": "approvia",
  "clientId": "frontend"
}
```

Set `KEYCLOAK_BASE_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_AUDIENCE`, and
`KEYCLOAK_REQUIRED_ROLE` for the gateway. Configure the production frontend
origin as an exact valid redirect URI, web origin, and post-logout redirect URI
in Keycloak. Do not use the development credentials from the realm export in a
production realm.

Set `RABBITMQ_URL`, `EXPENSE_SERVICE_QUEUE`, and
`EXPENSE_SERVICE_QUEUE_DURABLE` on both the gateway and expense service. Set
`EXPENSE_SERVICE_TIMEOUT_MS` on the gateway and `DATABASE_URL` on the expense
service. `DATABASE_URL` is mandatory outside the local development script. Use
TLS credentials and a dedicated RabbitMQ virtual host in production. The user
identity in microservice messages is trusted only because access to that broker
and queue is restricted to application services.

<a alt="Nx logo" href="https://nx.dev" target="_blank" rel="noreferrer"><img src="https://raw.githubusercontent.com/nrwl/nx/master/images/nx-logo.png" width="45"></a>

✨ Your new, shiny [Nx workspace](https://nx.dev) is ready ✨.

[Learn more about this workspace setup and its capabilities](https://nx.dev/nx-api/js?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or run `npx nx graph` to visually explore what was created. Now, let's get you up to speed!

## Generate a library

```sh
npx nx g @nx/js:lib packages/pkg1 --publishable --importPath=@my-org/pkg1
```

## Run tasks

To build the library use:

```sh
npx nx build pkg1
```

To run any task with Nx use:

```sh
npx nx <target> <project-name>
```

These targets are either [inferred automatically](https://nx.dev/concepts/inferred-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) or defined in the `project.json` or `package.json` files.

[More about running tasks in the docs &raquo;](https://nx.dev/features/run-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Versioning and releasing

To version and release the library use

```
npx nx release
```

Pass `--dry-run` to see what would happen without actually releasing the library.

[Learn more about Nx release &raquo;](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Set up CI!

### Step 1

To connect to Nx Cloud, run the following command:

```sh
npx nx connect
```

Connecting to Nx Cloud ensures a [fast and scalable CI](https://nx.dev/ci/intro/why-nx-cloud?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects) pipeline. It includes features such as:

- [Remote caching](https://nx.dev/ci/features/remote-cache?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task distribution across multiple machines](https://nx.dev/ci/features/distribute-task-execution?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Automated e2e test splitting](https://nx.dev/ci/features/split-e2e-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Task flakiness detection and rerunning](https://nx.dev/ci/features/flaky-tasks?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

### Step 2

Use the following command to configure a CI workflow for your workspace:

```sh
npx nx g ci-workflow
```

[Learn more about Nx on CI](https://nx.dev/ci/intro/ci-with-nx#ready-get-started-with-your-provider?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Install Nx Console

Nx Console is an editor extension that enriches your developer experience. It lets you run tasks, generate code, and improves code autocompletion in your IDE. It is available for VSCode and IntelliJ.

[Install Nx Console &raquo;](https://nx.dev/getting-started/editor-setup?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

## Useful links

Learn more:

- [Learn more about this workspace setup](https://nx.dev/nx-api/js?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Learn about Nx on CI](https://nx.dev/ci/intro/ci-with-nx?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [Releasing Packages with Nx release](https://nx.dev/features/manage-releases?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
- [What are Nx plugins?](https://nx.dev/concepts/nx-plugins?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)

And join the Nx community:

- [Discord](https://go.nx.dev/community)
- [Follow us on X](https://twitter.com/nxdevtools) or [LinkedIn](https://www.linkedin.com/company/nrwl)
- [Our Youtube channel](https://www.youtube.com/@nxdevtools)
- [Our blog](https://nx.dev/blog?utm_source=nx_project&utm_medium=readme&utm_campaign=nx_projects)
