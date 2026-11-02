# Playbook: design (UI, dashboards, sites)
**Enter when:** the task is mostly about how something looks or feels.
**Gates:** grilling on audience, tone, references, must-have screens. Propose 2–3 directions (sketch or prototype) and get a pick before building. Accessibility (WCAG 2.2 AA) is a required check.
**Outputs:** design tokens; the chosen direction recorded as an ADR; screenshots from the ui-verifier at mobile and desktop widths.
**Polish (when `features.unslop` is on):** after the build and before the ui-verifier screenshots, run the `unslop` skill on the changed screens (spacing, colour, icons, copy, type, layout, motion). unslop is by Damir Sokolovsky, https://github.com/heydamir/unslop, CC BY 4.0; pinned in `deps.lock.toml`.
**Figma and references:** with a Figma link, read it through the Figma MCP server (`saw recommend add figma` if it's missing; load `figma-design-to-code` first). When Figma's MCP hits a rate or plan limit, saw's failure hook says so: carry on in the built-in browser by opening the Figma file there and reading layout, spacing, colour and type from the page and screenshots. To match an existing site, or with no design file, open the site in the browser and use `extract-design-system` for its tokens.
**Done when:** the owner approves screenshots; contrast, keyboard and focus checks pass.
