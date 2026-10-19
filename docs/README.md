# PPI-2 implementation specification

Status: implementation specification, 16 October 2026. See [implementation status](implementation-status.md) for completed work and remaining release requirements.

PPI-2 replaces the PHP application with a SvelteKit and TypeScript application for finding, contributing, and reviewing exam protocols. Every account, including administrators, uses a verified zx student email address. A simple admin flag enables submission review, configuration and background-work controls through the website.

The system is a modular monolith: one repository, shared application logic, a web process, and background workers. Each module below defines its responsibilities, data, interfaces, access rules, failure behaviour, and acceptance criteria. These are implementation requirements for the proposed design, not claims that the functionality already exists.

## Read first

- [Architecture and shared contracts](architecture.md)
- [Data model and invariants](data-model.md)
- [Decisions and unresolved questions](decisions.md)
- [Delivery phases and release gates](delivery-plan.md)

## Module specifications

| Module | Technology | Specification |
|---|---|---|
| Student interface | Svelte, TypeScript, SvelteKit | [01 Student interface](modules/01-student-interface.md) |
| Admin interface | Svelte, TypeScript, SvelteKit | [02 Admin interface](modules/02-admin-interface.md) |
| Server application | TypeScript, SvelteKit | [03 Server application](modules/03-server-application.md) |
| Authentication and accounts | Better Auth, TypeScript | [04 Authentication](modules/04-authentication.md) |
| Catalogue and search | TypeScript, PostgreSQL | [05 Catalogue](modules/05-catalogue.md) |
| Submissions and private files | TypeScript, filesystem | [06 Submissions](modules/06-submissions.md) |
| Moderation | TypeScript, optional model integration | [07 Moderation](modules/07-moderation.md) |
| Document processing | TypeScript orchestration, native document tools | [08 Document processing](modules/08-document-processing.md) |
| Credits and access | TypeScript, PostgreSQL transactions | [09 Credits and access](modules/09-credits-and-access.md) |
| Background jobs | TypeScript, pg-boss, Node.js | [10 Background jobs](modules/10-background-jobs.md) |
| Notifications | TypeScript, SMTP | [11 Notifications](modules/11-notifications.md) |
| Database and migrations | PostgreSQL, node-postgres, numbered SQL migrations | [12 Database](modules/12-database.md) |
| Audit and operations visibility | TypeScript, structured logs, PostgreSQL | [13 Audit and operations](modules/13-audit-and-operations.md) |
| Deployment and recovery | Docker Compose, nginx, CI | [14 Deployment](modules/14-deployment.md) |
| Legacy import and cutover | Proposed TypeScript CLI, MariaDB reader | [15 Legacy migration](modules/15-legacy-migration.md) |

## Product boundary

Launch includes student registration, catalogue search, uploads, private downloads, manual moderation, configurable token accounting and shared rewards, website-controlled jobs, and migration of existing data. Automated content moderation is an interface placeholder only. Future providers may run locally or externally and support automatic acceptance and rejection; implementation and evaluation follow the core release. German is the default interface language, with English parity.

Initial scope excludes public protocol indexing, general social login, multi-university tenancy, a mobile app, collaborative document editing, and arbitrary scripts entered through the website. A structured protocol-writing form can be considered after the upload workflow is established.

## Baseline and evidence

The inspected application and fork both had commit `cf6e811` on `main`. The public deployment repository had commit `d2a2b1b` and states that deployment configuration is moving to private Gitea. Live schema, configuration, traffic, and backups must therefore be verified before migration.

- [Existing settings and token defaults](https://github.com/fsi-tue/ppi/blob/cf6e8116c4a67b5e230d71329d4fa693076779fd/core/constants/Constants.php)
- [Existing registration validation](https://github.com/fsi-tue/ppi/blob/cf6e8116c4a67b5e230d71329d4fa693076779fd/create.php)
- [Existing moderation actions](https://github.com/fsi-tue/ppi/blob/cf6e8116c4a67b5e230d71329d4fa693076779fd/viewexamprotocol.php)
- [Existing schema setup](https://github.com/fsi-tue/ppi/blob/cf6e8116c4a67b5e230d71329d4fa693076779fd/core/lib_classes/MySqlDBConnDatabaseUtility.php)
- [Existing recurring tasks](https://github.com/fsi-tue/ppi/blob/cf6e8116c4a67b5e230d71329d4fa693076779fd/core/system_classes/RecurringTasksSystem.php)
- [Public deployment configuration](https://github.com/fsi-tue/docker/tree/master/ppi)

Framework documentation supports the integration choices, while the module behaviour and limits in this specification are proposed PPI product requirements. Exact package and image versions will be pinned during the foundation phase after compatibility checks.
