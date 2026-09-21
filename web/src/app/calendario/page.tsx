"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getCalendar, saveTask, taskValuesSchema, type CalendarTask, type Employee, type TaskValues } from "@/features/calendar/api";

const STATUS = { pending: "Pendiente", in_progress: "En curso", completed: "Completada", cancelled: "Cancelada" };
const STATUS_CLASS = { pending: "bg-amber-100 text-amber-900", in_progress: "bg-blue-100 text-blue-900", completed: "bg-emerald-100 text-emerald-900", cancelled: "bg-muted text-muted-foreground" };
const SELECT_CLASS = "h-10 w-full rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";

function todayInUruguay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Montevideo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function CalendarPage() {
  const { brandId, brand } = useBrandEnvironment();
  return <EmployeeCalendar key={brandId} brandId={brandId} brandName={brand.name} />;
}

function EmployeeCalendar({ brandId, brandName }: { brandId: string; brandName: string }) {
  const queryClient = useQueryClient();
  const [selectedDay, setSelectedDay] = useState(todayInUruguay);
  const [employee, setEmployee] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [editor, setEditor] = useState<{ task?: CalendarTask; date: string; employee: string } | null>(null);
  const month = selectedDay.slice(0, 7);
  const query = useQuery({ queryKey: ["employee-calendar", brandId, month], queryFn: () => getCalendar(brandId, month) });
  const employees = query.data?.employees ?? [];
  const tasks = (query.data?.tasks ?? []).filter((task) => (!employee || task.employee_id === employee) && (showCancelled || task.status !== "cancelled"));
  const dayTasks = tasks.filter((task) => task.date === selectedDay);
  const monthDate = parseISO(`${month}-01`);
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 }) });
  const today = todayInUruguay();
  const selectedName = employees.find((item) => item.id === employee)?.name;
  const changeStatus = useMutation({
    mutationFn: ({ task, status }: { task: CalendarTask; status: TaskValues["status"] }) => saveTask(brandId, { status }, task.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["employee-calendar", brandId] }); toast.success("Tarea actualizada"); },
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{brandName}</p>
          <h1 className="mt-1 text-3xl font-semibold">Calendario de tareas</h1>
          <p className="mt-2 text-sm text-muted-foreground">Organizá el trabajo de cada empleado. Fechas y horarios de Uruguay.</p>
        </div>
        <Button className="h-10" disabled={!employees.length || !!editor} onClick={() => setEditor({ date: selectedDay, employee: employee || query.data?.viewer_employee_id || "" })}><Plus /> Nueva tarea</Button>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Calendario por empleado">
        {query.data?.can_view_team && <Button variant={!employee ? "default" : "outline"} aria-pressed={!employee} onClick={() => setEmployee("")}>Todo el equipo</Button>}
        {employees.map((person) => <Button key={person.id} variant={employee === person.id ? "default" : "outline"} aria-pressed={employee === person.id} onClick={() => setEmployee(person.id)}>{person.name}</Button>)}
      </div>

      {query.error && <div role="alert" className="rounded-lg border border-destructive p-4 text-sm"><p>{query.error.message}</p><Button variant="outline" className="mt-2" onClick={() => query.refetch()}>Reintentar</Button></div>}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="min-w-0 rounded-xl border bg-card p-3 sm:p-5" aria-label="Calendario mensual">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-xl font-semibold capitalize">{format(monthDate, "MMMM yyyy", { locale: es })}</h2><p className="text-sm text-muted-foreground">{selectedName || (query.data?.can_view_team ? "Todo el equipo" : "Mis tareas")}</p></div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Mes anterior" onClick={() => setSelectedDay(format(addMonths(parseISO(selectedDay), -1), "yyyy-MM-dd"))}><ChevronLeft /></Button>
              <Button variant="outline" onClick={() => setSelectedDay(today)}>Hoy</Button>
              <Button variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => setSelectedDay(format(addMonths(parseISO(selectedDay), 1), "yyyy-MM-dd"))}><ChevronRight /></Button>
            </div>
          </div>
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground">{["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => <div key={day} className="pb-3">{day}</div>)}</div>
          <div className="grid grid-cols-7 gap-1" aria-busy={query.isFetching}>
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const currentMonth = key.startsWith(month);
              const entries = currentMonth ? tasks.filter((task) => task.date === key) : [];
              return <button key={key} type="button" aria-label={`${format(day, "EEEE d 'de' MMMM", { locale: es })}${currentMonth ? `, ${entries.length} tareas` : ""}`} aria-pressed={key === selectedDay} aria-current={key === today ? "date" : undefined} onClick={() => setSelectedDay(key)} className={`min-h-20 min-w-0 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring sm:min-h-28 ${key === selectedDay ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted"} ${!currentMonth ? "text-muted-foreground/50" : ""}`}>
                <span className={`inline-flex size-6 items-center justify-center rounded-full text-sm ${key === today ? "bg-primary font-semibold text-primary-foreground" : ""}`}>{format(day, "d")}</span>
                {entries.length > 0 && <><span className="mt-1 block text-[10px] text-muted-foreground">{entries.length} {entries.length === 1 ? "tarea" : "tareas"}</span><div className="mt-1 hidden space-y-1 sm:block">{entries.slice(0, 2).map((task) => <div key={task.id} title={task.title} className={`truncate rounded px-1 py-0.5 text-[10px] ${STATUS_CLASS[task.status]}`}>{task.start_time && `${task.start_time} `}{task.title}</div>)}</div></>}
              </button>;
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
            <span role="status">{query.isFetching ? "Cargando tareas…" : `${tasks.filter((task) => task.status === "pending" || task.status === "in_progress").length} pendientes · ${tasks.filter((task) => task.status === "completed").length} completadas en el mes`}</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} /> Ver canceladas</label>
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          {editor && <TaskEditor key={editor.task?.id || "new"} brandId={brandId} employees={employees} task={editor.task} initialDate={editor.date} initialEmployee={editor.employee} onCancel={() => setEditor(null)} onSaved={(task) => { setEditor(null); setSelectedDay(task.date); setEmployee(task.employee_id); if (task.status === "cancelled") setShowCancelled(true); }} />}
          <section className="rounded-xl border bg-card p-4" aria-label="Tareas del día">
            <div className="mb-4 flex items-start gap-2"><CalendarDays className="mt-0.5 size-5 text-primary" /><div><h2 className="font-semibold capitalize">{format(parseISO(selectedDay), "EEEE d 'de' MMMM", { locale: es })}</h2><p className="text-xs text-muted-foreground">{selectedName || (query.data?.can_view_team ? "Todo el equipo" : "Mis tareas")}</p></div></div>
            {changeStatus.error && <p role="alert" className="mb-3 text-sm text-destructive">{changeStatus.error.message}</p>}
            {query.isPending ? <p className="text-sm text-muted-foreground">Cargando tareas…</p> : !query.error && !dayTasks.length ? <div className="rounded-lg border border-dashed p-5 text-center"><p className="text-sm text-muted-foreground">Sin tareas para este día.</p><Button variant="outline" className="mt-3" disabled={!employees.length || !!editor} onClick={() => setEditor({ date: selectedDay, employee: employee || query.data?.viewer_employee_id || "" })}>Anotar una tarea</Button></div> : null}
            <ul className="space-y-3">
              {dayTasks.map((task) => <li key={task.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold">{employees.find((person) => person.id === task.employee_id)?.name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_CLASS[task.status]}`}>{STATUS[task.status]}</span></div>
                <h3 className={`break-words font-medium ${task.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}>{task.title}</h3>
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" />{task.start_time ? `${task.start_time}${task.end_time ? ` – ${task.end_time}` : ""}` : "Sin horario fijo"}</p>
                {task.notes && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{task.notes}</p>}
                <div className="flex flex-wrap gap-2 pt-1"><Button variant="outline" size="sm" disabled={!!editor || changeStatus.isPending} onClick={() => setEditor({ task, date: task.date, employee: task.employee_id })}><Pencil /> Editar</Button>{task.status !== "completed" && task.status !== "cancelled" && <Button variant="outline" size="sm" disabled={changeStatus.isPending} onClick={() => changeStatus.mutate({ task, status: "completed" })}><Check /> Completar</Button>}</div>
              </li>)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function TaskEditor({ brandId, employees, task, initialDate, initialEmployee, onCancel, onSaved }: {
  brandId: string; employees: Employee[]; task?: CalendarTask; initialDate: string; initialEmployee: string;
  onCancel: () => void; onSaved: (task: CalendarTask) => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<TaskValues>({ resolver: zodResolver(taskValuesSchema), defaultValues: {
    employee_id: task?.employee_id || initialEmployee, title: task?.title || "", date: task?.date || initialDate,
    start_time: task?.start_time || "", end_time: task?.end_time || "", notes: task?.notes || "", status: task?.status || "pending",
  } });
  const mutation = useMutation({ mutationFn: (values: TaskValues) => saveTask(brandId, values, task?.id), onSuccess: (saved) => {
    queryClient.invalidateQueries({ queryKey: ["employee-calendar", brandId] });
    toast.success(task ? "Tarea actualizada" : "Tarea agendada"); onSaved(saved);
  } });
  const error = (field: keyof TaskValues) => form.formState.errors[field] ? <span role="alert" className="text-xs text-destructive">{form.formState.errors[field]?.message}</span> : null;
  return <form className="space-y-4 rounded-xl border border-primary/40 bg-card p-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
    <h2 className="font-semibold">{task ? "Editar tarea" : "Nueva tarea"}</h2>
    <fieldset className="space-y-3" disabled={mutation.isPending}>
      <label className="grid gap-1.5 text-sm">Empleado<select className={SELECT_CLASS} {...form.register("employee_id")}><option value="">Elegir empleado</option>{employees.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{error("employee_id")}</label>
      <label className="grid gap-1.5 text-sm">Tarea<Input autoFocus placeholder="Ej: preparar pedido de molduras" maxLength={200} {...form.register("title")} />{error("title")}</label>
      <label className="grid gap-1.5 text-sm">Fecha<Input type="date" {...form.register("date")} />{error("date")}</label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid min-w-0 gap-1.5 text-sm">Inicio (opcional)<Input type="time" {...form.register("start_time")} />{error("start_time")}</label>
        <label className="grid min-w-0 gap-1.5 text-sm">Fin (opcional)<Input type="time" {...form.register("end_time")} />{error("end_time")}</label>
      </div>
      <label className="grid gap-1.5 text-sm">Detalles<Textarea rows={3} placeholder="Indicaciones, cliente o número de pedido" maxLength={3000} {...form.register("notes")} />{error("notes")}</label>
      <label className="grid gap-1.5 text-sm">Estado<select className={SELECT_CLASS} {...form.register("status")}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{error("status")}</label>
    </fieldset>
    {mutation.error && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    <div className="flex gap-2"><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Guardando…" : "Guardar tarea"}</Button><Button type="button" variant="outline" disabled={mutation.isPending} onClick={onCancel}>Cerrar</Button></div>
  </form>;
}
