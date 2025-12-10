import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { Clipboard } from "@tui/util/clipboard"
import type { PromptInfo } from "@tui/component/prompt/history"

export function DialogMessage(props: {
  messageID: string
  sessionID: string
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const sdk = useSDK()
  const message = createMemo(() => sync.data.message[props.sessionID]?.find((x) => x.id === props.messageID))
  const route = useRoute()

  // Check if there's currently a pending assistant message (task in progress)
  const pending = createMemo(() => {
    const allMessages = sync.data.message[props.sessionID] ?? []
    return allMessages.find((x) => x.role === "assistant" && !x.time.completed)
  })

  // Check if this message is queued (has no assistant response yet and there's a pending task)
  const isQueued = createMemo(() => {
    if (!pending()) return false
    const msg = message()
    if (!msg || msg.role !== "user") return false
    const allMessages = sync.data.message[props.sessionID] ?? []
    const hasResponse = allMessages.some((m) => m.role === "assistant" && m.parentID === msg.id)
    return !hasResponse
  })

  // Find all queued messages and this message's position (1-indexed)
  const queuePosition = createMemo(() => {
    if (!isQueued()) return 0
    const allMessages = sync.data.message[props.sessionID] ?? []
    // Get all user messages that have no assistant response (queued)
    const queuedMessages = allMessages.filter((m) => {
      if (m.role !== "user") return false
      return !allMessages.some((other) => other.role === "assistant" && other.parentID === m.id)
    })
    const index = queuedMessages.findIndex((m) => m.id === props.messageID)
    return index >= 0 ? index + 1 : 0
  })

  const options = createMemo(() => {
    const opts: DialogSelectOption[] = []

    // Add cancel option for queued messages - uses revert to remove from queue
    if (isQueued() && queuePosition() > 0) {
      opts.push({
        title: "Cancel",
        value: "queue.cancel",
        description: "remove from queue",
        onSelect: (dialog) => {
          // Revert this message to remove it from the queue
          sdk.client.session.revert({
            sessionID: props.sessionID,
            messageID: props.messageID,
          })
          dialog.clear()
        },
      })
    }

    opts.push(
      {
        title: "Revert",
        value: "session.revert",
        description: "undo messages and file changes",
        onSelect: (dialog) => {
          const msg = message()
          if (!msg) return

          sdk.client.session.revert({
            sessionID: props.sessionID,
            messageID: msg.id,
          })

          if (props.setPrompt) {
            const parts = sync.data.part[msg.id]
            const promptInfo = parts.reduce(
              (agg, part) => {
                if (part.type === "text") {
                  if (!part.synthetic) agg.input += part.text
                }
                if (part.type === "file") agg.parts.push(part)
                return agg
              },
              { input: "", parts: [] as PromptInfo["parts"] },
            )
            props.setPrompt(promptInfo)
          }

          dialog.clear()
        },
      },
      {
        title: "Copy",
        value: "message.copy",
        description: "copy message text to clipboard",
        onSelect: async (dialog) => {
          const msg = message()
          if (!msg) return

          const parts = sync.data.part[msg.id]
          const text = parts.reduce((agg, part) => {
            if (part.type === "text" && !part.synthetic) {
              agg += part.text
            }
            return agg
          }, "")

          await Clipboard.copy(text)
          dialog.clear()
        },
      },
      {
        title: "Fork",
        value: "session.fork",
        description: "create a new session",
        onSelect: async (dialog) => {
          const result = await sdk.client.session.fork({
            sessionID: props.sessionID,
            messageID: props.messageID,
          })
          route.navigate({
            sessionID: result.data!.id,
            type: "session",
          })
          dialog.clear()
        },
      },
    )

    return opts
  })

  return <DialogSelect title="Message Actions" options={options()} />
}
