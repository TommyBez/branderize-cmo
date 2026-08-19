# Private CMO

The CMO surface lists owner-private conversations and opens a new one from a title. Intents and Objects stay visible to the brand; the chat does not.

## Sub-features

- `cmo-list` shows the private archive for the current user.
- `cmo-open` creates a conversation from New conversation.
- `cmo-composer` exposes Message to the CMO and Send on an opened thread.

## How to get to it (user POV)

- Choose `CMO` in the sidebar.
- From an empty Intent register, choose `Go to the CMO →`.
- Open an existing conversation link in Your archive.

## Driving it with verify-branderize

Preconditions:

- Fleet launch is healthy. The user is signed in as an owner, admin, or member (not viewer).
- The CMO index heading `Yours alone, inside the brand.` is visible.

- **Empty archive.** If there are no conversations, the compact empty state says `You do not have a conversation for this brand yet.`
- **Name a thread.** Fill `New conversation` with `Verify CMO <runId>`. Run `page.getByLabel('New conversation').fill('Verify CMO <runId>')`.
- **Open.** Choose `Open`. Run `page.getByRole('button', { name: 'Open' }).click()`. The URL matches `/brands/<brandId>/cmo/<conversationId>`.
- **Composer.** The textbox `Message to the CMO` is present. The submit button is `Send`. Helper text says `Turns stay private to the conversation owner.`
- **Empty transcript.** A new thread shows `Start from an outcome, not a task list.`
- **Reload.** The `Reload` button refreshes agent status without creating a second conversation.
- **Proof.** Return to `CMO` in the sidebar. The archive contains a link named `Verify CMO <runId>`. Capture that list. Opening the link again must show the same conversation URL, not a new id.

## Gotchas

- Sending a turn talks to the real local CMO root and may create hosted Vercel sandboxes. Proving `cmo-open` does not require `Send`. If you do send, say so in the evidence and wait for a visible assistant message or an error alert. Do not treat a spinner as success.
- Viewer role sees `Your current role cannot open or send new ones.` Do not fail the feature for a missing `Open` button in that case.
- Conversation titles are owner-private. Another signed-in member of the same brand must not see `Verify CMO <runId>` in their archive.
- `sourceTaskId` in the query string is a Work claim for the next turn only. Leave it unset unless you are proving that path.
- Cleanup stops the fleet. It does not delete the conversation row.
