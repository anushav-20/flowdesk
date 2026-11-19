/**
 * Multi-step approval workflow as an explicit state machine.
 *
 *   none ──submit──▶ pending(step 0) ──approve──▶ pending(step 1) … ──approve(last)──▶ approved
 *                        │                                                         (task → done)
 *                        └──reject(reason)──▶ rejected ──resubmit──▶ pending(step 0)
 *
 * Every transition is validated and appended to an immutable history.
 */

export const DEFAULT_CHAIN = [
  { id: 'lead', name: 'Team lead review' },
  { id: 'qa', name: 'QA approval' },
  { id: 'pm', name: 'Final approval (PM)' },
]

export const initialApproval = () => ({ status: 'none', step: 0, history: [] })

export class ApprovalError extends Error {}

/**
 * @param {{status:string, step:number, history:any[]}} approval
 * @param {{ type: 'submit'|'approve'|'reject'|'resubmit', actorId: string, reason?: string, at: number }} event
 * @param {{ chain: {id:string,name:string,approverId?:string}[], isOwner?: boolean }} ctx
 */
export function transition(approval, event, { chain, isOwner = false }) {
  const a = approval ?? initialApproval()
  const entry = { type: event.type, actorId: event.actorId, at: event.at, step: a.step }

  switch (event.type) {
    case 'submit':
    case 'resubmit': {
      const allowed = event.type === 'submit' ? ['none'] : ['rejected']
      if (!allowed.includes(a.status)) throw new ApprovalError(`Cannot ${event.type} while ${a.status}`)
      if (chain.length === 0) throw new ApprovalError('No approval steps configured')
      return { status: 'pending', step: 0, history: [...a.history, { ...entry, step: 0 }] }
    }
    case 'approve': {
      if (a.status !== 'pending') throw new ApprovalError('Nothing is waiting for approval')
      assertApprover(chain[a.step], event.actorId, isOwner)
      const last = a.step >= chain.length - 1
      return {
        status: last ? 'approved' : 'pending',
        step: last ? a.step : a.step + 1,
        history: [...a.history, entry],
      }
    }
    case 'reject': {
      if (a.status !== 'pending') throw new ApprovalError('Nothing is waiting for approval')
      assertApprover(chain[a.step], event.actorId, isOwner)
      const reason = String(event.reason ?? '').trim()
      if (reason.length < 3) throw new ApprovalError('A rejection reason is required')
      return { status: 'rejected', step: a.step, history: [...a.history, { ...entry, reason: reason.slice(0, 500) }] }
    }
    default:
      throw new ApprovalError(`Unknown approval event: ${event.type}`)
  }
}

function assertApprover(step, actorId, isOwner) {
  if (!step) throw new ApprovalError('Invalid approval step')
  if (step.approverId && step.approverId !== actorId && !isOwner) {
    throw new ApprovalError(`Only the assigned approver can act on "${step.name}"`)
  }
}

/** Who must act next, for display. */
export function currentStep(approval, chain) {
  return approval?.status === 'pending' ? chain[approval.step] : null
}
