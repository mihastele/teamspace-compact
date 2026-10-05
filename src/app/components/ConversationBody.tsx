import type { ReactNode } from "react";
import type { ConversationComment } from "../../lib/model";

/** Plain text only: server-resolved mention names never become HTML. */
export default function ConversationBody({
  comment,
  className,
  mentionClassName,
}: {
  comment: ConversationComment;
  className?: string;
  mentionClassName?: string;
}) {
  if (comment.deleted) return <div className={className}>Comment deleted.</div>;
  const parts: ReactNode[] = [];
  const pattern = /@\{([^{}]+)\}/g;
  let offset = 0;
  for (const match of comment.body.matchAll(pattern)) {
    parts.push(comment.body.slice(offset, match.index));
    const member = comment.mentions.find((mention) => mention.uid === match[1]);
    parts.push(
      member ? (
        <span className={mentionClassName} key={match.index}>
          @{member.displayName}
        </span>
      ) : (
        match[0]
      ),
    );
    offset = match.index! + match[0].length;
  }
  parts.push(comment.body.slice(offset));
  return <div className={className}>{parts}</div>;
}
