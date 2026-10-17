import { STATUS_LABELS, type Task } from "@/lib/tasks/schema";
import { TaskActions } from "./TaskActions";

export function TaskList({ tasks, today }: { tasks: Task[]; today: string }) {
  return (
    <ul className="task-list">
      {tasks.map((t) => {
        const overdue = t.status !== "done" && t.due_date < today;
        return (
          <li key={t.id} className={`task ${t.status === "done" ? "is-done" : ""}`}>
            <div className="task-main">
              <h2 className="task-title">{t.title}</h2>
              <div className="task-meta">
                <span className={`badge status-${t.status}`}>{STATUS_LABELS[t.status]}</span>
                <span className={`badge priority-${t.priority}`}>P{t.priority}</span>
                <span className={overdue ? "overdue" : undefined}>
                  Due {t.due_date}
                  {overdue && " · overdue"}
                </span>
              </div>
              {t.notes && <p className="task-notes">{t.notes}</p>}
            </div>
            <TaskActions id={t.id} title={t.title} status={t.status} />
          </li>
        );
      })}
    </ul>
  );
}
