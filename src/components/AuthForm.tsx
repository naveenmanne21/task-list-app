"use client";

import { useActionState } from "react";
import type { AuthFormState } from "@/app/(auth)/actions";

type Props = {
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
};

export function AuthForm({ action, submitLabel, passwordAutoComplete }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="stack" noValidate>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}

      <label className="field">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          aria-invalid={!!state.fieldErrors?.email}
        />
        {state.fieldErrors?.email && <span className="field-error">{state.fieldErrors.email}</span>}
      </label>

      <label className="field">
        Password
        <input
          name="password"
          type="password"
          autoComplete={passwordAutoComplete}
          required
          aria-invalid={!!state.fieldErrors?.password}
        />
        {state.fieldErrors?.password && <span className="field-error">{state.fieldErrors.password}</span>}
      </label>

      <button type="submit" disabled={pending}>
        {pending ? "Please wait…" : submitLabel}
      </button>
    </form>
  );
}
