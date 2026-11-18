// Late-bound callbacks so routes do not depend on the push module directly.
import type { Task } from "../../shared/types.ts";

export const hooks = {
  /** Called when users are assigned to a task by `byUserId`. */
  onAssigned: (_task: Task, _byUserId: number, _userIds: number[]): void => {},
};
