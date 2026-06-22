/**
 * @crm2/sdk — ADR-0058 server-side uppercase safety net.
 *
 * Uppercase a human-entered DISPLAY-TEXT value so data written by ANY client (web,
 * mobile, direct API) is stored UPPERCASE, matching what the UI renders. The web
 * <Input>/<TextArea> components uppercase as the user types; this is the contract-level
 * guarantee for non-web writers.
 *
 * Append to a string field:  `z.string().trim().min(1).max(150).transform(toUpper)`
 *
 * DO NOT apply to: usernames, emails, passwords, phone numbers, URLs, UUIDs/IDs,
 * regex-validated UPPER_SNAKE codes (already uppercase by constraint), enums, or
 * content/template/JSON blobs (markdown / handlebars bodies). Those preserve case.
 */
export const toUpper = (value: string): string => value.toUpperCase();
