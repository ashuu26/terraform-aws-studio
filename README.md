# Terraform AWS Studio

An interactive studio for learning the `hashicorp/aws` provider. You pick AWS services, configure them, and get a Terraform project where the resources reference each other. You can then review the code, learn what each block does, and download the project as a ZIP.

## What's in this folder

| Path | Purpose |
| --- | --- |
| `index.html` | The whole app in one self-contained file (built output). |
| `src/catalog.js` | Service catalog: metadata, config fields and one Terraform generator per service. |
| `src/engine.js` | Project assembly, `fmt`-style alignment, static validation and HCL syntax highlighting. |
| `src/learn.js` | Learning content: resource summaries, concept topics, CLI and auth notes, Registry module map. |
| `src/ui.js`, `src/views.js` | UI state, header, summary panel, service cards, drawers, and the six views. |
| `src/styles.css`, `src/template.html` | Styles and the HTML shell. |
| `src/build.py` | Inlines CSS and JS into `index.html`. |
| `src/test.js` | Generates every service alone, all services together and every preset, then runs the static checks. |
| `sample-project/` | Output of the "Guided example: web server in a VPC" preset, exactly as the dashboard produces it. |

## Prerequisites

- Any modern browser to use the dashboard.
- Python 3.8+ to rebuild `index.html` from `src/`.
- Node.js 18+ to run the generator tests.
- For deploying generated code:
  - Terraform 1.8 or newer. Native S3 state locking needs 1.10 or newer.
  - AWS CLI v2.
  - An AWS identity: IAM Identity Center, a CLI profile, or an IAM role.

## Run locally

No install step is needed. Open `index.html` in a browser, or serve the folder:

```bash
cd terraform-aws-dashboard
python3 -m http.server 8080
# open http://localhost:8080
```

The page loads JSZip from cdnjs and fonts from Google Fonts. Offline, everything still works except ZIP downloads, and the fonts fall back to system fonts.

## Build

```bash
cd src
python3 build.py          # writes dist/index.html
node test.js              # generator and validation smoke test
```

## Adding a new service

1. Add an `S({...})` entry in `catalog.js`, in the section for its category. The fields are:
   - `id`, `name`, `cat`, `diff` (`Beginner`, `Intermediate` or `Advanced`) and `file` (the output file name).
   - `res`: every provider resource type the service generates. Registry links are derived from this list.
   - `deps`: IDs of other services. These drive the dependency suggestions.
   - `kw` (search keywords), `desc`, `use` and `assume` (assumptions shown in the configuration drawer).
   - `fields`: form inputs, each shaped `{ k, l, t: text|number|bool|select|list, d, o, h }`.
   - `gen(c, x)`: returns the HCL. Use the context helpers:
     - `x.v()` declares a variable and returns `var.name`.
     - `x.o()` adds an output.
     - `x.data()` adds a shared data source.
     - `x.has(id)` checks whether a service is selected.
     - `x.vpcId()`, `x.privateIds()` and `x.publicIds()` return a direct reference, or an input variable when the dependency isn't selected.
2. Add each new resource type to `RES_INFO` in `learn.js`. Each entry is a plain-language summary, the key arguments and the key attributes.
3. If a terraform-aws-modules module covers the service, add its ID to that module's `covers` list in `MODULES`.
4. Give the service an abbreviation in `ABBR` (`ui.js`), and put it in an architecture row in `ARCH_ROWS` (`views.js`).
5. Run `node test.js`. Every service is generated alone and combined with the others, and the static checks must report no errors.

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
   - One file per service.
   - `outputs.tf` and `terraform.tfvars.example`.
4. `tidy()` aligns `=` signs and blank lines in the style of `terraform fmt`.
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
