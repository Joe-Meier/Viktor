import type { Thread } from "./types";

export const SAMPLE_THREAD_ID = "sample-ledgerline";

/** A worked example so the app is explorable before any real email is pasted. */
export function createSampleThread(now: Date = new Date()): Thread {
  const at = (daysAgo: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 12, 0, 0);
    return d.toISOString();
  };
  return {
    id: SAMPLE_THREAD_ID,
    title: "Dana Whitcombe, Ledgerline",
    subject: "Cutting invoice processing time at your company",
    counterparty: "Dana Whitcombe",
    isSample: true,
    level: 2,
    createdAt: at(6, 9),
    updatedAt: at(1, 15),
    messages: [
      {
        id: "sample-m1",
        from: "them",
        senderName: "Dana Whitcombe",
        createdAt: at(6, 9),
        body: "Hi Joe,\n\nI noticed your team has been growing and wanted to reach out. Ledgerline automates accounts payable end to end: invoice capture, approval routing and payments in one place. Finance teams your size typically cut invoice processing time by 70 percent in the first quarter.\n\nWould you be open to a 20-minute call next week?\n\nBest,\nDana Whitcombe\nAccount Executive, Ledgerline",
      },
      {
        id: "sample-m2",
        from: "me",
        senderName: "You",
        createdAt: at(5, 11),
        body: "Hi Dana,\n\nThanks for reaching out. Could you send over a little more information? Our approvals are currently handled verbally by my uncle Raymond, so anything that routes approvals would need to account for that.",
      },
      {
        id: "sample-m3",
        from: "them",
        senderName: "Dana Whitcombe",
        createdAt: at(4, 10),
        body: "Thanks Joe, happy to. I've attached our overview deck. Ledgerline supports fully custom approval chains, so we can mirror whatever Raymond's process looks like today. Pricing starts at $480 per month on an annual subscription.\n\nDoes Thursday at 2pm work for a quick walkthrough?\n\nDana",
      },
      {
        id: "sample-m4",
        from: "me",
        senderName: "You",
        createdAt: at(3, 16),
        body: "Hi Dana,\n\nRaymond has reviewed the deck and asked me to pass along that he does not enter into subscriptions, as a matter of principle. He would consider purchasing Ledgerline outright, provided the approval chain includes a step where he initials a printed copy of each invoice. Thursday works, though he will need the walkthrough mailed to him in advance.",
      },
      {
        id: "sample-m5",
        from: "them",
        senderName: "Dana Whitcombe",
        createdAt: at(1, 15),
        body: "Understood. We don't usually offer perpetual licenses, but I've asked our deal desk about a one-time payment option. On the initials: we can generate a PDF approval sheet for each invoice that can be printed, initialed and scanned back in.\n\nI'll mail the walkthrough materials today. Can you confirm the mailing address?\n\nDana",
      },
    ],
    registry: {
      uncles: [
        {
          id: "uncle-1",
          name: "Raymond",
          role: "Head of approvals",
          authority: ["All purchase approvals, given verbally"],
          traits: [
            "Does not enter into subscriptions, as a matter of principle",
            "Initials a printed copy of every invoice",
          ],
          introducedTurn: 1,
        },
      ],
      disagreements: [],
      requests: [
        {
          id: "request-1",
          from: "Raymond",
          request: "Offer Ledgerline as a one-time purchase rather than a subscription",
          status: "open",
          introducedTurn: 2,
        },
        {
          id: "request-2",
          from: "Raymond",
          request: "Mail the walkthrough materials to him before Thursday",
          status: "open",
          introducedTurn: 2,
        },
      ],
      facts: [
        { id: "fact-1", text: "Approvals are currently handled verbally.", introducedTurn: 1 },
        { id: "fact-2", text: "Raymond has reviewed the Ledgerline overview deck.", introducedTurn: 2 },
        { id: "fact-3", text: "A walkthrough is planned for Thursday at 2pm.", introducedTurn: 2 },
      ],
    },
    draft: {
      level: 2,
      createdAt: at(1, 15),
      text: "Hi Dana,\n\nThank you, the approval sheet is very close to what we need. Please send the materials to Raymond's attention at the lake house; he asks that the envelope not mention software. One complication has come up: my uncle Walt signs off on everything for our Tucson location and will only initial in green ink, which Raymond considers inappropriate for financial documents. Could the approval sheet include two initial fields, ideally on separate pages?",
      update: {
        newUncles: [
          {
            name: "Walt",
            role: "Signatory, Tucson location",
            authority: ["Signs off on everything for the Tucson location"],
            traits: ["Initials only in green ink"],
          },
        ],
        uncleUpdates: [
          {
            name: "Raymond",
            addTraits: ["Considers green ink inappropriate for financial documents"],
            addAuthority: [],
          },
        ],
        newFacts: [
          "Raymond receives mail at the lake house.",
          "Envelopes addressed to Raymond must not mention software.",
        ],
        newDisagreements: [
          { parties: ["Raymond", "Walt"], subject: "Whether green ink is acceptable on financial documents" },
        ],
        newRequests: [
          { from: null, request: "Provide two initial fields on the approval sheet, ideally on separate pages" },
        ],
        resolvedRequestIds: [],
      },
    },
  };
}
