import { useCallback, useEffect, useRef, useState } from "react";

type UseTurnAnchorLayoutParams = {
  loading: boolean;
  messagesCount: number;
  progressLogCount: number;
  liveStatus: string;
};

const ANCHOR_TOP_GAP = 10;

export function useTurnAnchorLayout({
  loading,
  messagesCount,
  progressLogCount,
  liveStatus,
}: UseTurnAnchorLayoutParams) {
  const [activeTurnUserId, setActiveTurnUserId] = useState<string | null>(null);
  const [activeTurnAssistantId, setActiveTurnAssistantId] = useState<string | null>(null);
  const [turnBottomSpacer, setTurnBottomSpacer] = useState(0);

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingRowRef = useRef<HTMLDivElement | null>(null);
  const messageRowRefs = useRef(new Map<string, HTMLDivElement>());
  const anchoredTurnRef = useRef<string | null>(null);

  const registerMessageRow = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      messageRowRefs.current.set(id, node);
    } else {
      messageRowRefs.current.delete(id);
    }
  }, []);

  const beginTurn = useCallback((userMessageId: string) => {
    setActiveTurnUserId(userMessageId);
    setActiveTurnAssistantId(null);
  }, []);

  const completeTurn = useCallback((assistantMessageId: string) => {
    setActiveTurnAssistantId(assistantMessageId);
  }, []);

  const resetTurnAnchor = useCallback(() => {
    setActiveTurnUserId(null);
    setActiveTurnAssistantId(null);
    setTurnBottomSpacer(0);
    anchoredTurnRef.current = null;
  }, []);

  useEffect(() => {
    if (!activeTurnUserId) {
      anchoredTurnRef.current = null;
      return;
    }
    if (anchoredTurnRef.current === activeTurnUserId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const viewport = scrollViewportRef.current;
      const userRow = messageRowRefs.current.get(activeTurnUserId);
      if (!viewport || !userRow) {
        return;
      }
      viewport.scrollTo({
        top: Math.max(0, userRow.offsetTop - ANCHOR_TOP_GAP),
        behavior: "smooth",
      });
      anchoredTurnRef.current = activeTurnUserId;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTurnUserId, messagesCount]);

  const recomputeTurnBottomSpacer = useCallback(() => {
    if (!activeTurnUserId) {
      setTurnBottomSpacer(0);
      return;
    }

    const viewport = scrollViewportRef.current;
    const userRow = messageRowRefs.current.get(activeTurnUserId);
    if (!viewport || !userRow) {
      setTurnBottomSpacer(0);
      return;
    }

    const assistantRow = loading
      ? loadingRowRef.current
      : activeTurnAssistantId
      ? messageRowRefs.current.get(activeTurnAssistantId) ?? null
      : null;

    const viewportHeight = viewport.clientHeight;
    const viewportPaddingBottom = Number.parseFloat(window.getComputedStyle(viewport).paddingBottom) || 0;
    const usableViewportHeight = Math.max(0, viewportHeight - viewportPaddingBottom);
    const userHeight = userRow.offsetHeight;
    const assistantHeight = assistantRow?.offsetHeight ?? 0;
    const betweenGap = assistantRow
      ? Math.max(0, assistantRow.offsetTop - (userRow.offsetTop + userHeight))
      : 0;

    const next = Math.max(
      0,
      Math.round(usableViewportHeight - ANCHOR_TOP_GAP - userHeight - assistantHeight - betweenGap)
    );
    setTurnBottomSpacer((prev) => (prev === next ? prev : next));
  }, [activeTurnAssistantId, activeTurnUserId, loading]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      recomputeTurnBottomSpacer();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    recomputeTurnBottomSpacer,
    messagesCount,
    loading,
    progressLogCount,
    liveStatus,
    activeTurnUserId,
    activeTurnAssistantId,
  ]);

  useEffect(() => {
    const onResize = () => {
      recomputeTurnBottomSpacer();
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recomputeTurnBottomSpacer]);

  return {
    activeTurnUserId,
    turnBottomSpacer,
    scrollViewportRef,
    loadingRowRef,
    registerMessageRow,
    beginTurn,
    completeTurn,
    resetTurnAnchor,
  };
}
