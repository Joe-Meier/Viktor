import { z } from "zod";

const str = z.string();
const strList = z.array(z.string()).default([]);

/** Shape the model must return. Missing arrays default to empty. */
export const registryUpdateSchema = z.object({
  newUncles: z
    .array(
      z.object({
        name: str.min(1),
        role: str.default(""),
        authority: strList,
        traits: strList,
      }),
    )
    .default([]),
  uncleUpdates: z
    .array(
      z.object({
        name: str.min(1),
        addTraits: strList,
        addAuthority: strList,
      }),
    )
    .default([]),
  newFacts: strList,
  newDisagreements: z
    .array(z.object({ parties: z.array(z.string()).default([]), subject: str.min(1) }))
    .default([]),
  newRequests: z
    .array(z.object({ from: z.string().nullable().default(null), request: str.min(1) }))
    .default([]),
  resolvedRequestIds: strList,
});

export const modelOutputSchema = z.object({
  reply: str.min(1),
  registry: registryUpdateSchema.default({
    newUncles: [],
    uncleUpdates: [],
    newFacts: [],
    newDisagreements: [],
    newRequests: [],
    resolvedRequestIds: [],
  }),
});

export type ModelOutput = z.infer<typeof modelOutputSchema>;

const levelSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const registrySchema = z.object({
  uncles: z.array(
    z.object({
      id: str,
      name: str,
      role: str,
      authority: z.array(str),
      traits: z.array(str),
      introducedTurn: z.number(),
    }),
  ),
  disagreements: z.array(
    z.object({ id: str, parties: z.array(str), subject: str, introducedTurn: z.number() }),
  ),
  requests: z.array(
    z.object({
      id: str,
      from: str.nullable(),
      request: str,
      status: z.enum(["open", "resolved"]),
      introducedTurn: z.number(),
    }),
  ),
  facts: z.array(z.object({ id: str, text: str, introducedTurn: z.number() })),
});

export const messageSchema = z.object({
  id: str,
  from: z.enum(["them", "me"]),
  senderName: str,
  body: str,
  createdAt: str,
});

const MAX_BODY = 20_000;

/** Body of POST /api/reply. */
export const replyRequestSchema = z.object({
  subject: str.max(500).default(""),
  counterparty: str.max(200).default(""),
  messages: z
    .array(messageSchema.extend({ body: str.max(MAX_BODY) }))
    .min(1)
    .max(60),
  registry: registrySchema,
  level: levelSchema,
  previousDraft: str.max(MAX_BODY).optional(),
});

export type ReplyRequest = z.infer<typeof replyRequestSchema>;

export const draftSchema = z.object({
  text: str,
  level: levelSchema,
  update: registryUpdateSchema,
  createdAt: str,
});

export const threadSchema = z.object({
  id: str,
  title: str,
  subject: str,
  counterparty: str,
  isSample: z.boolean(),
  level: levelSchema,
  messages: z.array(messageSchema),
  registry: registrySchema,
  draft: draftSchema.nullable(),
  createdAt: str,
  updatedAt: str,
});
