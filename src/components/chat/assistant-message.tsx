"use client";

import { useRouter } from "next/navigation";
import { AILabel, AILabelContent, Button, CopyButton, InlineNotification, SkeletonText } from "@carbon/react";
import { ArrowRight, ArrowUpRight, Renew, SearchLocate, WatsonxAi } from "@carbon/icons-react";
import { scopeForTab } from "@/lib/chat-scope";
import { useChatStore } from "@/store/chat-store";
import { useDashboardStore } from "@/store/dashboard-store";
import type { ChatMessage, ChatScope } from "@/types/chat";
import { AnswerBlocks } from "./answer-blocks";
import { CitationList } from "./citation-list";
import { MarkdownAnswer } from "./markdown-answer";
import styles from "./chat.module.scss";

type AssistantChatMessage = Extract<ChatMessage, { role: "assistant" }>;

const timeFormat = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" });

export function AiExplainability({ size }: { size: "mini" | "2xs" | "sm" }) {
  return (
    <AILabel size={size} autoAlign aria-label="Penjelasan AI">
      <AILabelContent>
        <p className={styles.citationPopoverMeta}>Penjelasan AI</p>
        <p className={styles.citationPopoverTitle}>Jawaban dihasilkan oleh model bahasa (LLM)</p>
        <p className={styles.citationPopoverSnippet}>
          Asisten IKU mencari potongan relevan dari Buku IKU Diktisaintek Berdampak V1 dan data modul Monev IKU, lalu
          menyusun jawaban beserta sumbernya. Jawaban bersifat panduan dan bukan keputusan resmi.
        </p>
      </AILabelContent>
    </AILabel>
  );
}

type AssistantMessageProps = {
  message: AssistantChatMessage;
  /** Cakupan halaman tempat percakapan ini berada. */
  scope: ChatScope;
  isSending: boolean;
};

export function AssistantMessage({ message, scope, isSending }: AssistantMessageProps) {
  const router = useRouter();
  const retry = useChatStore((state) => state.retry);
  const send = useChatStore((state) => state.send);
  const setActiveDashboardTab = useDashboardStore((state) => state.setActiveDashboardTab);

  const answer = message.answer;
  const isStreaming = message.status === "streaming";
  const suggestedTab = answer?.outOfScope?.suggestedTab;
  const showAction = answer?.action && answer.action.dashboardTab !== scope.id;

  // Ikuti pola menu samping AppShell: di /dashboard, URL diperbarui sinkron sebelum state tab,
  // karena AppShell menyinkronkan tab aktif dari query ?tab=.
  const openDashboardTab = (tab: string) => {
    const params = new URLSearchParams(window.location.pathname === "/dashboard" ? window.location.search : "");
    params.set("tab", tab);
    if (window.location.pathname === "/dashboard") {
      window.history.replaceState({}, "", `/dashboard?${params.toString()}`);
      setActiveDashboardTab(tab);
    } else {
      setActiveDashboardTab(tab);
      router.push(`/dashboard?${params.toString()}`);
    }
  };

  // Pindah ke halaman yang sesuai lalu ajukan ulang pertanyaan pada cakupan tersebut.
  const askInScope = (tab: string) => {
    void send(message.question, scopeForTab(tab));
    openDashboardTab(tab);
  };

  return (
    <article className={styles.assistantMessage} aria-busy={isStreaming}>
      <header className={styles.assistantHeader}>
        <span className={styles.botAvatar} aria-hidden="true">
          <WatsonxAi size={16} />
        </span>
        <span>Asisten IKU</span>
        <time className={styles.meta} dateTime={message.createdAt}>
          · {timeFormat.format(new Date(message.createdAt))}
        </time>
        <AiExplainability size="mini" />
      </header>

      {isStreaming && !message.text && (
        <>
          <p className={styles.status} role="status">
            <SearchLocate size={16} aria-hidden="true" />
            {message.statusText}
          </p>
          <div aria-hidden="true">
            <SkeletonText paragraph lineCount={3} className="cds--skeleton__text--ai" />
          </div>
        </>
      )}

      {message.text && <MarkdownAnswer text={message.text} />}

      {answer && !answer.grounded && (
        <InlineNotification
          kind="warning"
          lowContrast
          hideCloseButton
          title="Konteks tidak ditemukan."
          subtitle="Jawaban ini tidak didukung dokumen sumber."
        />
      )}

      {answer?.outOfScope && (
        <InlineNotification
          kind="info"
          lowContrast
          hideCloseButton
          title={`Di luar cakupan ${scope.label}.`}
          subtitle={
            suggestedTab
              ? `Pertanyaan ini dijawab di halaman ${suggestedTab}.`
              : "Ajukan pertanyaan yang sesuai dengan halaman ini."
          }
        />
      )}

      {answer?.blocks && <AnswerBlocks blocks={answer.blocks} />}
      {answer && <CitationList citations={answer.citations} />}

      {message.status === "error" && (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="Jawaban gagal dimuat."
          subtitle={message.error}
        />
      )}

      {answer?.outOfScope ? (
        // Jawaban di luar cakupan: cukup arahkan ke halaman yang sesuai (buat ulang akan ditolak lagi).
        suggestedTab && (
          <div className={styles.actions}>
            <Button kind="tertiary" size="md" renderIcon={ArrowRight} onClick={() => askInScope(suggestedTab)}>
              Tanyakan di {suggestedTab}
            </Button>
          </div>
        )
      ) : (
        message.status !== "streaming" && (
          <div className={styles.actions}>
            <div className={styles.actionIcons}>
              {answer && (
                <CopyButton
                  iconDescription="Salin jawaban"
                  feedback="Tersalin"
                  onClick={() => void navigator.clipboard?.writeText(answer.answer)}
                />
              )}
              {message.status === "error" && (
                <Button
                  kind="ghost"
                  size="md"
                  renderIcon={Renew}
                  disabled={isSending}
                  onClick={() => void retry(message.id, scope)}
                >
                  Coba lagi
                </Button>
              )}
            </div>
            {showAction && (
              <Button
                kind="tertiary"
                size="md"
                renderIcon={ArrowUpRight}
                onClick={() => openDashboardTab(answer.action!.dashboardTab)}
              >
                {answer.action!.label}
              </Button>
            )}
          </div>
        )
      )}
    </article>
  );
}
