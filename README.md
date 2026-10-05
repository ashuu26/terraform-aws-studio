# Terraform Studio (AWS and Azure)

An interactive studio for learning the `hashicorp/aws` provider. You pick AWS services, configure them, and get a Terraform project where the resources reference each other. You can then review the code, learn what each block does, and download the project as a ZIP.

## What's in this folder

| Path | Purpose |
| --- | --- |
| `index.html`, `assets/landing.css`, `assets/landing.js` | Landing page: interactive AWS / Azure chooser (live topology, typed `terraform plan`, keyboard shortcuts, last-used provider). Public. |
| `login.html` | Sign-in page (Google and GitHub through Firebase Authentication). |
| `aws/index.html` | The AWS studio in one self-contained file (built output). Requires sign-in. |
| `azure/index.html` | Azure studio placeholder (in development). Requires sign-in. |
| `assets/auth-config.js` | Firebase web app settings, enabled providers and optional email allow-lists. |
| `assets/auth.js`, `assets/theme.js`, `assets/site.css` | Sign-in logic and page gate, shared light/dark theme, styles for the landing, login and Azure pages. |
| `src/catalog.js` | Service catalog: metadata, config fields and one Terraform generator per service. |
| `src/landingzone.js` | AWS Landing Zone model, starter templates, SCP templates, Control Tower control catalog, model checks and the `landing_zone` generator. |
| `src/engine.js` | Project assembly, `fmt`-style alignment, static validation and HCL syntax highlighting. |
| `src/learn.js` | Learning content: resource summaries, concept topics, CLI and auth notes, Registry module map. |
| `src/ui.js`, `src/views.js`, `src/landing.js` | UI state, header, summary panel, service cards, drawers, the seven views, and the Landing Zone dashboard and wizard. |
| `src/styles.css`, `src/template.html` | Styles and the HTML shell. |
| `src/build.py` | Inlines CSS and JS into the AWS studio page. |
| `src/test.js` | Generates every service alone, all services together and every preset, then runs the static checks and the AWS Backup, CloudWatch and Landing Zone assertions. Exits non-zero on a failure. |
| `sample-project/` | Output of the "Guided example: web server in a VPC" preset, exactly as the dashboard produces it. |

## Prerequisites

- Any modern browser to use the dashboard.
- Python 3.8+ to rebuild `aws/index.html` from `src/`.
- A Firebase project for Google and GitHub sign-in (free Spark plan is enough).
- Node.js 18+ to run the generator tests.
- For deploying generated code:
  - Terraform 1.8 or newer. Native S3 state locking needs 1.10 or newer.
  - AWS CLI v2.
  - An AWS identity: IAM Identity Center, a CLI profile, or an IAM role.

## Run locally

No install step is needed. Serve the folder and open the landing page:

```bash
cd terraform-aws-dashboard
python3 -m http.server 8080
# open http://localhost:8080
```

The page loads JSZip from cdnjs and fonts from Google Fonts. Offline, everything still works except ZIP downloads and sign-in, and the fonts fall back to system fonts.

Until `assets/auth-config.js` is filled in, the login page shows **Continue in local preview mode** on `localhost`, `127.0.0.1` and `file://` so you can work on the studio without signing in. On any other host, the studios stay locked until sign-in is configured.

## Sign-in (Google and GitHub)

Visitors land on `index.html` and choose AWS or Azure. Opening a studio needs a Google or GitHub sign-in, handled by Firebase Authentication from the browser, so no server is needed.

1. **Create a Firebase project** at <https://console.firebase.google.com>, then go to *Project settings > General > Your apps* and add a **Web app**. Copy `apiKey`, `authDomain`, `projectId` and `appId` into `assets/auth-config.js`. These values identify the project; they are not secrets.
2. **Google**: in *Authentication > Sign-in method*, enable **Google** and pick a support email.
3. **GitHub**:
   1. In *Authentication > Sign-in method*, enable **GitHub** and copy the callback URL it shows (`https://<project>.firebaseapp.com/__/auth/handler`).
   2. On GitHub, open *Settings > Developer settings > OAuth Apps > New OAuth App*. Set the homepage to your site URL and the authorization callback URL to the value from the previous step.
   3. Paste the GitHub **Client ID** and **Client secret** into the Firebase GitHub provider and save. The secret is stored in Firebase, never in this repository.
4. **Authorized domains**: in *Authentication > Settings > Authorized domains*, add the domain that serves the site, for example `ashuu26.github.io`. `localhost` is there by default.
5. Optional: to limit who can open the studios, set `allowedEmailDomains` (for example `['softwareone.com']`) or `allowedEmails` in `assets/auth-config.js`.

If someone signs in with GitHub and Google using the same email, Firebase rejects the second method by default (`account-exists-with-different-credential`), and the login page explains this. To let one person use both, change *Authentication > Settings > User account linking* to "Create multiple accounts for each identity provider".

**What the gate protects.** This is a static site, so the check runs in the browser. It decides who gets the studio experience, but the HTML and JavaScript files are still public to anyone who requests them directly. Don't put secrets or private data in the studio files. For real access control, host the site behind a server-side check such as Firebase Hosting with a function, Cloudflare Access or Azure Static Web Apps authentication.

## Build

```bash
cd src
python3 build.py          # writes dist/index.html
node test.js              # generator and validation tests (add --print to dump sample files)
```

`build.py` writes `src/dist/index.html`; copy it over `aws/index.html` (not the root `index.html`, which is now the landing page). Run it with Python in UTF-8 mode (`python3 -X utf8 build.py`) on Windows, because the sources contain non-ASCII characters.

## Adding a new service

1. Add an `S({...})` entry in `catalog.js`, in the section for its category. A new category also needs a `CATS` entry, a colour token in `styles.css` (light and both dark blocks) and a `CAT_VAR` entry in `ui.js`. The fields are:
   - `id`, `name`, `cat`, `diff` (`Beginner`, `Intermediate` or `Advanced`) and `file` (the output file name).
   - `res`: every provider resource type the service generates. Registry links are derived from this list.
   - `deps`: IDs of other services. These drive the dependency suggestions.
   - `suggest(config, has)` (optional): extra dependency IDs that depend on the configuration, such as the service a CloudWatch alarm watches.
   - `kw` (search keywords), `desc`, `use`, `assume` (assumptions shown in the configuration drawer) and `guide` (educational security notes).
   - `fields`: form inputs, each shaped `{ k, l, t: text|number|bool|select|list|multi, d, o, h }`. Optional extras:
     - `when: (config, has) => bool` shows the field only when it applies.
     - `presets` on a select fills other fields when an option is picked.
     - Layout-only entries without `k`: `{ t: 'section', l }` and `{ t: 'note', l, level: 'info' | 'warn' }`.
   - `gen(c, x)`: returns the HCL for `<file>.tf`, or an array of `{ stem, title, desc, body }` to write several flat files (AWS Backup and CloudWatch do this). Use the context helpers:
     - `x.v()` declares a variable and returns `var.name`.
     - `x.o()` adds an output.
     - `x.data()` adds a shared data source.
     - `x.has(id)` checks whether a service is selected, and `x.cfgOf(id)` reads another service's settings.
     - `x.note()` adds a generator note, shown with the file and in the ZIP README.
     - `x.vpcId()`, `x.privateIds()` and `x.publicIds()` return a direct reference, or an input variable when the dependency isn't selected.
2. Add each new resource type to `RES_INFO` in `learn.js`. Each entry is a plain-language summary, the key arguments and the key attributes. Optionally add a `RES_GUIDE` entry (why, dependencies, architecture, common mistakes, example) and a `SERVICE_GUIDES` entry.
3. If a terraform-aws-modules module covers the service, add its ID to that module's `covers` list in `MODULES`.
4. Give the service an abbreviation in `ABBR` (`ui.js`), and put it in an architecture row in `ARCH_ROWS` (`views.js`). Services built from optional parts can list them in `COMPONENTS` (`ui.js`) for the summary panel.
5. Run `node test.js`. Every service is generated alone and combined with the others, and the static checks must report no errors. Then run `terraform init` and `terraform validate` on a generated project.

## AWS Backup and Amazon CloudWatch

- **AWS Backup** (Backup category) writes `backup_vault.tf`, `backup_plan.tf`, `backup_selection.tf` and, with Vault Lock on, `backup_vault_lock.tf`. It covers vault encryption, an optional vault access policy, plan rules (time zone, windows, cold storage, continuous backup, copy actions), selection by selected services, tags, ARNs or wildcard resource types, the IAM role with the AWS managed backup, restore and S3 policies, and Vault Lock in governance or compliance mode.
- **Amazon CloudWatch** (Monitoring category) writes `cloudwatch_log_group.tf`, `cloudwatch_alarm.tf`, `cloudwatch_dashboard.tf`, `eventbridge.tf`, `sns.tf` and `backup_notifications.tf`, each only when something in it is turned on. It covers log groups and streams, metric filters, metric and composite alarms whose dimensions reference the selected EC2, ALB, RDS or Lambda, a dashboard built from the selected services, EventBridge rules and an SNS topic whose policy allows only the services that publish to it.
- With both selected, CloudWatch adds backup job failure and completion rules, vault notifications, and a backup jobs dashboard widget.
- Restores are not generated: Terraform has no resource that runs a restore job. `aws_backup_region_settings` is not generated either, because the opt-in settings are account-wide.
- EventBridge resources keep their original Terraform names (`aws_cloudwatch_event_rule`, `aws_cloudwatch_event_target`). Rules use `state`, because `is_enabled` is deprecated.

## AWS Landing Zone

The **Landing Zone** tab builds a multi-account foundation. It is one catalog service (`landing_zone`, category Landing Zone) whose configuration is a structured model edited in a nine-step wizard instead of the drawer form: Type, Organization, OUs, Accounts, Placement, Governance (SCPs), Control Tower, Review and Generate.

- **Enterprise** uses AWS Organizations and AWS Control Tower. **Non-Enterprise** uses AWS Organizations only; the Control Tower step is disabled. Neither model is presented as better.
- Both starter templates are listed under "Start from an example" too. Every OU, account and policy in them can be renamed, moved or removed.
- Model, templates, checks and the generator live in `landingzone.js`. The UI is in `landing.js`. Because the model is not form fields, the service provides `defaults()` instead of `fields`, and `openConfig` sends it to the wizard.

Generated files (flat, like every other service):

| File | Resources |
| --- | --- |
| `organization.tf` | `aws_organizations_organization` (create, or `import` block), or `data.aws_organizations_organization` for an existing one |
| `organizational_units.tf` | `aws_organizations_organizational_unit`; nested OUs reference their parent |
| `default_accounts.tf`, `custom_accounts.tf` | `aws_organizations_account`; placement is its `parent_id` |
| `existing_accounts.tf` | `import` blocks for accounts to adopt and move; referenced accounts are only IDs in `var.existing_account_ids` |
| `service_control_policies.tf`, `scp_attachments.tf` | `aws_organizations_policy` (type `SERVICE_CONTROL_POLICY`, `jsonencode` content) and `aws_organizations_policy_attachment` to the root, OUs or accounts |
| `control_tower_roles.tf` | The three documented service roles in `/service-role/` (Enterprise, new landing zone) |
| `control_tower.tf` | `aws_controltower_landing_zone` with a landing zone 4.0 manifest |
| `control_tower_baselines.tf` | `aws_controltower_baseline` (AWSControlTowerBaseline 5.0) to register OUs and enroll their accounts |
| `control_tower_controls.tf` | `aws_controltower_control` with the documented legacy control identifiers |
| `account_factory.tf` | `aws_servicecatalog_provisioned_product` of the "AWS Control Tower Account Factory" product |

Design decisions and limits:

- There is no account-to-OU attachment resource in the provider. Moving an account is a change to `parent_id`, and existing accounts are adopted with `import` blocks and `ignore_changes = [name, email]`, so they are never recreated.
- Enterprise accounts default to `role_name = "AWSControlTowerExecution"`, which Control Tower needs to enroll an account when its OU is registered.
- SCP templates come from [aws-samples/service-control-policy-examples](https://github.com/aws-samples/service-control-policy-examples). No SCP is created or attached unless the user adds it and picks targets. User-supplied policy text is quoted with `lzq()`, which escapes IAM policy variables such as `${aws:PrincipalAccount}` to `$${...}`.
- Not generated, because the provider has no resource for them: landing zone repair and reset, mandatory controls, Account Factory network and blueprint settings, and single-account enrollment without registering the OU. The wizard and the Generate step list these with their alternatives.
- No credentials are generated. Account emails are placeholders in `var.accounts`. Account Factory needs `account_factory_provisioning_artifact_id`, which has no default.
- The checks in `lzCheck()` cover the OU hierarchy (duplicates, missing parents, more than five levels, loops), account emails and IDs, placement, SCP JSON, size and the 5-per-target quota, and Control Tower prerequisites (Log Archive and Audit in one top-level OU, home Region governed, controls only on registered OUs).

Checked on 2026-10-01: the Enterprise and Non-Enterprise templates, plus imported organization, existing organization, existing landing zone, Account Factory, every SCP template, a JSON SCP and a combination with VPC, Transit Gateway, S3, AWS Backup and CloudWatch, all pass `terraform validate` with hashicorp/aws 6.67.0 and Terraform 1.16.4.

## Updating provider versions

- In `engine.js`, `PROVIDER_SNAPSHOT` records the latest `hashicorp/aws` release seen and the date it was checked. It is currently **6.56.0, checked 2026-09-25**. Update it from https://registry.terraform.io/providers/hashicorp/aws/latest.
- The constraint options offered in the header are in `PROVIDER_OPTIONS` (`ui.js`). The default `~> 6.0` accepts any 6.x release. `terraform init` resolves the newest matching release and records it in `.terraform.lock.hcl`.
- `TF_VERSIONS` controls the Terraform version selector, which sets `required_version`.
- When a new major provider version ships, review its upgrade guide on the Registry. Then re-run `node test.js`, and run `terraform validate` against the new version for a sample of presets.

## How generation works

1. The dashboard walks the selected services in catalog order and calls each service's `gen(config, ctx)`.
2. Generators reference each other directly when both are selected, for example `subnet_id = values(aws_subnet.private)[0].id`. When a dependency isn't selected, the generator declares an input variable such as `var.vpc_id` instead.
3. Variables, outputs and shared data sources are collected along the way. The engine then writes these files:
   - `providers.tf`, `locals.tf`, `variables.tf` and `data.tf`.
   - One file per service, or one file per part for AWS Backup and CloudWatch.
   - `outputs.tf` and `terraform.tfvars.example`.
4. `tidy()` aligns `=` signs and blank lines in the style of `terraform fmt`. As in `fmt`, an attribute whose value spans several lines is not padded.
5. The code follows these conventions:
   - Default tags go on the provider, and names are built from a `name_prefix` local.
   - Security group rules are separate resources, and EC2 instances require IMDSv2.
   - Volumes use encrypted gp3, and S3 buckets block public access and enforce bucket-owner object ownership.
   - RDS and Aurora use `manage_master_user_password`, so no password is ever written.
   - WAF for CloudFront uses a `us_east_1` provider alias.

## How Registry documentation is referenced

Every Registry URL is derived from a real resource type (see `docUrl` in `catalog.js`). Resources map to `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/<name>` and data sources to `.../docs/data-sources/<name>`. Module links point to `https://registry.terraform.io/modules/terraform-aws-modules/<module>/aws/latest`. No URLs are invented, and each link opens the live `latest` page.

The argument and attribute lists in `learn.js` are a hand-curated, commonly used subset. They are not a copy of the full schema.

## Limitations

- **Validation is static only.** The checks run in the browser and cover:
  - brackets and strings
  - undeclared and unused variables
  - unresolved references
  - outputs
  - the provider block
  - a scan for credentials and secrets
  - design rules such as security group ports and ASG sizes

  They are not `terraform validate`, which needs the provider schema. Always run `terraform init` and `terraform validate` before trusting generated code.
- **Provider versions are a snapshot.** The published page cannot fetch the Registry, because the host's content-security policy blocks it.
- **The stack differs from the spec.** It uses vanilla JavaScript rather than React, TypeScript and Tailwind, and a lightweight custom editor rather than Monaco. Both choices keep the app to one file with no build dependencies.
- **Category layout prefixes file names instead of using subfolders.** Terraform only loads `.tf` files from the working directory, so category subfolders would turn into modules that nothing calls. Module-based structure is explained in the Modules tab rather than generated.
- **Single-file downloads come as ZIPs.** When the dashboard is published on claude.ai, `.tf` is not an allowed download type, so single files are wrapped in a `.zip`. When you run it locally, downloads use the browser directly.
- **Generated code is for learning, not a production baseline.** It uses one shared security group, a single NAT gateway and simplified IAM. The assumptions for each service are listed in its configuration drawer.
