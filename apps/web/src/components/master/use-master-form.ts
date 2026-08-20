'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form';
import type { MasterOptions } from '@ntms/shared';
import type { ZodTypeAny } from 'zod';
import { ApiRequestError } from '@/lib/api-client';
import { useApiMutation, useApiQuery } from '@/lib/query';
import { useToast } from '@/components/ui/toast';

/**
 * 기준정보 폼 일곱 개가 같이 쓰는 배선.
 *
 * 화면마다 다른 것은 **칸의 구성뿐**이다. 불러오기 · 저장 · 삭제 · 오류를
 * 필드에 매다는 절차는 전부 같으므로 여기서 한 번만 쓴다. 폼마다 따로 쓰면
 * "서버가 준 필드 오류를 화면에 붙이는" 부분이 일곱 갈래로 갈라지고,
 * 그중 몇은 조용히 빠진다.
 */
export interface MasterFormState<TValues extends FieldValues> {
  form: UseFormReturn<TValues>;
  options: MasterOptions | undefined;
  /** 수정 대상을 아직 불러오는 중 */
  loading: boolean;
  submitting: boolean;
  deleting: boolean;
  /** 어느 칸에도 매달 수 없는 오류 */
  formError: string | null;
  submit: () => void;
  /** 수정 중일 때만 쓴다. 등록 화면에는 지울 것이 없다 */
  remove: () => void;
  isEdit: boolean;
}

export function useMasterForm<TValues extends FieldValues>({
  resource,
  id,
  open,
  schema,
  blank,
  listKeys,
  entityLabel,
  onSaved,
}: {
  /** `partners` · `vehicles` 처럼 API 경로의 자원 이름 */
  resource: string;
  /** null 이면 등록, 값이 있으면 수정 */
  id: string | null;
  open: boolean;
  schema: ZodTypeAny;
  /** 등록일 때 채우는 빈 값 */
  blank: DefaultValues<TValues>;
  /**
   * 저장 뒤 다시 불러야 하는 목록의 질의 키.
   *
   * 거래처 하나를 고치면 화주 · 운송사 · 거래처 세 목록이 같이 달라진다.
   * 지금 보고 있는 목록만 갱신하면 옆 화면으로 옮겼을 때 옛 값이 남는다.
   */
  listKeys: readonly string[];
  /** 알림 문구에 쓰는 이름 — "차량을 등록했습니다" */
  entityLabel: string;
  onSaved: () => void;
}): MasterFormState<TValues> {
  const isEdit = id !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const toast = useToast();

  const form = useForm<TValues>({
    resolver: zodResolver(schema),
    defaultValues: blank,
    mode: 'onBlur',
  });

  const options = useApiQuery<MasterOptions>(['master-options'], '/master/options', {
    enabled: open,
    // 참조 목록은 자주 바뀌지 않는다. 서랍을 열 때마다 다시 부르지 않는다.
    staleTime: 5 * 60_000,
  });

  const detail = useApiQuery<TValues & { id: string }>(
    ['master-detail', resource, id],
    `/master/${resource}/${id ?? ''}`,
    { enabled: open && isEdit, staleTime: 0, gcTime: 0 },
  );

  const invalidate = [...listKeys.map((k) => [k] as const), ['master-options']];

  const save = useApiMutation<{ id: string }, TValues>(
    () => ({
      path: isEdit ? `/master/${resource}/${id}` : `/master/${resource}`,
      method: isEdit ? 'PATCH' : 'POST',
    }),
    {
      invalidate,
      onSuccess: () => {
        // 등록은 목록 총계가 하나 늘어 눈에 띄지만, 값만 고친 수정은 화면이
        // 거의 그대로다. 저장됐다는 사실을 말로 한 번 해 준다.
        toast.success(`${entityLabel}을(를) ${isEdit ? '저장' : '등록'}했습니다`);
        onSaved();
      },
    },
  );

  const del = useApiMutation<{ id: string }, void>(
    () => ({ path: `/master/${resource}/${id}`, method: 'DELETE' }),
    {
      invalidate,
      onSuccess: () => {
        toast.success(`${entityLabel}을(를) 삭제했습니다`);
        onSaved();
      },
    },
  );

  // 서랍이 열릴 때마다 칸을 다시 채운다. 이전에 열었던 행의 값이 남아 있으면
  // 새로 등록하려던 사람이 남의 값을 저장하게 된다.
  const detailData = detail.data;
  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (!isEdit) {
      form.reset(blank);
      return;
    }
    if (detailData) form.reset(detailData as unknown as DefaultValues<TValues>);
    // form 과 blank 는 매 렌더 새 참조라 의존성에서 뺀다 — 넣으면 매번 다시 채워
    // 사용자가 친 값을 지운다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, detailData]);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values as TValues);
    } catch (error) {
      if (!(error instanceof ApiRequestError)) {
        setFormError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      // 서버가 필드를 짚어 줬으면 그 칸 아래에 붙인다. 위쪽 배너에 모아 두면
      // 긴 폼에서 어느 칸이 문제인지 다시 찾아 내려와야 한다.
      const fields = error.fields;
      let attached = false;
      if (fields) {
        for (const [name, messages] of Object.entries(fields)) {
          const message = messages[0];
          if (!message) continue;
          form.setError(name as never, { type: 'server', message });
          attached = true;
        }
      }
      if (!attached) setFormError(error.message);
    }
  });

  const remove = () => {
    setFormError(null);
    del.mutateAsync().catch((error: unknown) => {
      // 삭제 거절은 대개 "무엇이 이걸 쓰고 있다" 는 소식이다. 서랍 안 배너와
      // 알림 양쪽에 띄운다 — 배너는 서랍을 닫으면 사라지지만 알림은 남는다.
      const message =
        error instanceof ApiRequestError
          ? error.message
          : '삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      setFormError(message);
      toast.danger('삭제하지 못했습니다', message);
    });
  };

  return {
    form,
    options: options.data,
    loading: isEdit && detail.isLoading,
    submitting: save.isPending || form.formState.isSubmitting,
    deleting: del.isPending,
    formError,
    submit,
    remove,
    isEdit,
  };
}

/** `RefOption[]` 을 SelectField 가 받는 모양으로 */
export function toSelectOptions(
  list: { id: string; code: string; name: string; group?: string | null }[] | undefined,
): { value: string; label: string; note?: string | null }[] {
  return (list ?? []).map((o) => ({
    value: o.id,
    label: o.name,
    note: o.group ?? o.code,
  }));
}

/** 열거값 배열을 라벨 맵과 묶어 SelectField 가 받는 모양으로 */
export function toEnumOptions(
  values: readonly string[],
  labels: Record<string, string>,
): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: labels[v] ?? v }));
}
