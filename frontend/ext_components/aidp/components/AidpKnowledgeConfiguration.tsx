"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { App, Row, Col, Modal } from "antd";
import { InfoCircleFilled } from "@ant-design/icons";

import {
  SETUP_PAGE_CONTAINER,
  TWO_COLUMN_LAYOUT,
  STANDARD_CARD,
} from "@/const/layoutConstants";
import {
  AIDP_DOC_STATUS_POLL_MS,
  KB_SEARCH_DEBOUNCE_MS,
} from "@/const/knowledgeBase";
import type { AidpKnowledgeBaseItem } from "@/types/agentConfig";
import aidpKnowledgeService, {
  type AidpKbDetail,
  type AidpDocumentItem,
} from "@/ext_components/aidp/services/aidpKnowledgeService";
import log from "@/lib/logger";

import AidpKnowledgeList from "./AidpKnowledgeList";
import AidpDocumentList from "./AidpDocumentList";
import AidpCreateKbModal from "./AidpCreateKbModal";
import AidpUpdateKbModal from "./AidpUpdateKbModal";

const AidpKnowledgeConfiguration: React.FC = () => {
  const { t } = useTranslation();
  const { message: appMessage } = App.useApp();

  // ---- KB list state ----
  const [kbs, setKbs] = useState<AidpKnowledgeBaseItem[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(false);
  const [kbTotal, setKbTotal] = useState(0);
  const [kbHasMore, setKbHasMore] = useState(false);
  const [kbTotalReliable, setKbTotalReliable] = useState(true);

  // ---- Active KB / document state ----
  // activeKbId is stored separately from the paginated `kbs` list, because
  // refetching the KB list (e.g. after upload) returns only the current page,
  // which may not contain the currently active KB. `selectedKb` is the item
  // itself — set on selection, kept stable across list refetches.
  const [activeKbId, setActiveKbId] = useState<string | null>(null);
  const [selectedKb, setSelectedKb] = useState<AidpKnowledgeBaseItem | null>(null);
  const [activeKbDetail, setActiveKbDetail] = useState<AidpKbDetail | null>(null);
  const [documents, setDocuments] = useState<AidpDocumentItem[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [docHasMore, setDocHasMore] = useState(false);
  const [docTotalReliable, setDocTotalReliable] = useState(true);
  // Files still being processed across the whole knowledge base (not just the
  // visible page). Drives the status polling below.
  const [docProcessingCount, setDocProcessingCount] = useState(0);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // ---- Pagination state ----
  const KB_PAGE_SIZE = 10;
  const DOC_PAGE_SIZE = 10;
  const [kbPage, setKbPage] = useState(1);
  const [docPage, setDocPage] = useState(1);

  // ---- Modal state ----
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<AidpKnowledgeBaseItem | null>(null);

  // ---- Keyword search state ----
  // `kbKeyword` is the raw input value and keeps the text field responsive;
  // `debouncedKbKeyword` is what actually drives requests. Splitting them means
  // typing never waits on the network, and a pause settles on one request.
  const [kbKeyword, setKbKeyword] = useState("");
  const [debouncedKbKeyword, setDebouncedKbKeyword] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKbKeyword(kbKeyword.trim());
    }, KB_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [kbKeyword]);

  // ---- Fetch KB list (server-side pagination: each page fetches page_size items + Count total) ----
  const fetchKbs = useCallback(
    async (page: number = 1, keyword: string = "") => {
      setLoadingKbs(true);
      try {
        const result = await aidpKnowledgeService.listKbs(
          page,
          KB_PAGE_SIZE,
          keyword,
        );
        setKbs(result.value);
        setKbTotal(result.total_count ?? result.value.length);
        setKbHasMore(result.has_more ?? false);
        setKbTotalReliable(result.total_reliable !== false);
        setKbPage(page);
      } catch (error) {
        log.error("Failed to fetch AIDP knowledge bases:", error);
        appMessage.error(t("aidpKnowledge.fetchKbsFailed"));
        setKbs([]);
        setKbTotal(0);
        setKbHasMore(false);
        setKbTotalReliable(false);
      } finally {
        setLoadingKbs(false);
      }
    },
    [appMessage, t]
  );

  // Fetch on mount, and again whenever the debounced keyword settles.
  // Every keyword change restarts at page 1 on purpose: the previous page
  // number is meaningless against a different result set and would otherwise
  // render an empty list whenever the filtered set is shorter than that page.
  useEffect(() => {
    fetchKbs(1, debouncedKbKeyword);
  }, [fetchKbs, debouncedKbKeyword]);

  // ---- Cleanup legacy localStorage credentials on mount ----
  // v7.1: AIDP credentials moved backend-side; frontends that pre-date the
  // migration may still carry serverUrl / apiKey in localStorage. Remove
  // them on mount so a stale value cannot accidentally leak.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem("aidp_kb_server_url");
      window.localStorage.removeItem("aidp_kb_api_key");
    } catch {
      // localStorage may be unavailable in some test/SSR environments;
      // ignore — the cleanup is best-effort.
    }
  }, []);

  // ---- Fetch documents for active KB (server-side pagination) ----
  // `silent` refreshes are used by the status poller: the table keeps rendering
  // the previous page instead of flashing the loading placeholder, and a failed
  // poll stays out of the way (logged only) so a short upstream hiccup cannot
  // spam the user with a toast every interval. The manual refresh button always
  // runs a non-silent fetch, so errors stay visible when the user asks for them.
  const fetchDocs = useCallback(
    async (kbId: string, page: number = 1, options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      if (!silent) setLoadingDocs(true);
      try {
        const result = await aidpKnowledgeService.listDocs(
          kbId,
          page,
          DOC_PAGE_SIZE,
        );
        const count = result.total_count ?? result.value.length;
        setDocuments(result.value);
        setTotalDocs(count);
        setDocHasMore(result.has_more ?? false);
        setDocTotalReliable(result.total_reliable !== false);
        setDocProcessingCount(result.processing_count ?? 0);
        setDocPage(page);
      } catch (error) {
        log.error("Failed to fetch AIDP documents:", error);
        if (!silent) {
          appMessage.error(t("aidpKnowledge.fetchDocsFailed"));
          setDocuments([]);
          setTotalDocs(0);
          setDocHasMore(false);
          setDocTotalReliable(false);
          setDocProcessingCount(0);
        }
      } finally {
        if (!silent) setLoadingDocs(false);
      }
    },
    [appMessage, t]
  );

  // ---- Poll document status while anything is still being processed ----
  // AIDP ingests uploaded files asynchronously (chunking, embedding, indexing),
  // so the list refreshes itself every AIDP_DOC_STATUS_POLL_MS until every file
  // reports a terminal status (COMPLETED/FAILED). `docProcessingCount` counts
  // the whole knowledge base, so polling also continues while a processing file
  // sits on a page the user is not looking at. Changing KB or page restarts the
  // timer, and unmounting clears it.
  useEffect(() => {
    if (!activeKbId || docProcessingCount <= 0) return;
    const timer = window.setInterval(() => {
      void fetchDocs(activeKbId, docPage, { silent: true });
    }, AIDP_DOC_STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeKbId, docPage, docProcessingCount, fetchDocs]);

  // ---- Handle KB selection ----
  const handleSelectKb = useCallback(
    (kb: AidpKnowledgeBaseItem) => {
      setActiveKbId(kb.kds_id);
      setSelectedKb(kb);
      setDocPage(1);
      setDocHasMore(false);
      setDocTotalReliable(true);
      setDocProcessingCount(0);
      fetchDocs(kb.kds_id, 1);
    },
    [fetchDocs]
  );

  // ---- Handle KB deletion ----
  const handleDeleteKb = useCallback(
    (kb: AidpKnowledgeBaseItem) => {
      Modal.confirm({
        title: t("aidpKnowledge.confirmDeleteTitle"),
        content: t("aidpKnowledge.confirmDeleteContent", {
          name: kb.kds_name,
        }),
        okText: t("common.confirm"),
        cancelText: t("common.cancel"),
        okButtonProps: { danger: true },
        centered: true,
        onOk: async () => {
          try {
            await aidpKnowledgeService.deleteKb(kb.kds_id);
            appMessage.success(t("aidpKnowledge.deleteKbSuccess"));

            // If the deleted KB was active, clear selection
            if (activeKbId === kb.kds_id) {
              setActiveKbId(null);
              setSelectedKb(null);
              setActiveKbDetail(null);
              setDocuments([]);
              setTotalDocs(0);
              setDocHasMore(false);
              setDocTotalReliable(true);
              setDocProcessingCount(0);
              setDocPage(1);
            }

            // Refresh list, keeping the active search filter applied
            fetchKbs(kbPage, debouncedKbKeyword);
          } catch (error) {
            appMessage.error(t("aidpKnowledge.deleteKbFailed"));
          }
        },
      });
    },
    [activeKbId, appMessage, t, fetchKbs, kbPage, debouncedKbKeyword]
  );

  // ---- Edit KB ----
  const handleEditKb = useCallback((kb: AidpKnowledgeBaseItem) => {
    setEditingKb(kb);
    setUpdateModalOpen(true);
  }, []);

  // ---- After update success ----
  // Apply the returned resource locally instead of reloading the full KB page.
  const handleUpdateKbSuccess = useCallback(
    (updatedKb: AidpKnowledgeBaseItem) => {
      setUpdateModalOpen(false);
      setEditingKb(null);
      setKbs((current) =>
        current.map((kb) => (kb.kds_id === updatedKb.kds_id ? updatedKb : kb))
      );
      if (activeKbId === updatedKb.kds_id) {
        setSelectedKb(updatedKb);
        setActiveKbDetail(updatedKb);
      }
    },
    [activeKbId]
  );

  // ---- After create success ----
  // The create response already contains the resource. Insert it locally
  // instead of scanning up to 50 expensive server-side pages.
  const handleCreateKbSuccess = useCallback(
    (newKb: AidpKnowledgeBaseItem) => {
      setCreateModalOpen(false);
      setKbs((current) =>
        [newKb, ...current.filter((kb) => kb.kds_id !== newKb.kds_id)].slice(
          0,
          KB_PAGE_SIZE
        )
      );
      setKbTotal((current) => {
        const nextTotal = current + 1;
        setKbHasMore(kbPage * KB_PAGE_SIZE < nextTotal);
        return nextTotal;
      });
      setKbTotalReliable(true);
      setActiveKbId(newKb.kds_id);
      setSelectedKb(newKb);
      setActiveKbDetail(newKb);
      setDocPage(1);
      setDocHasMore(false);
      setDocTotalReliable(true);
      setDocProcessingCount(0);
      void fetchDocs(newKb.kds_id, 1);
    },
    [fetchDocs, kbPage]
  );

  // ---- After documents uploaded ----
  const handleDocsUploaded = useCallback(() => {
    if (activeKbId) {
      // Reset doc pagination to page 1 so data and pagination UI stay in sync
      setDocPage(1);
      void fetchDocs(activeKbId, 1);
      void aidpKnowledgeService
        .getKb(activeKbId)
        .then((detail) => {
          const refreshed = {
            ...selectedKb,
            ...detail,
            kds_id: activeKbId,
            kds_name: detail.kds_name || selectedKb?.kds_name || activeKbId,
          } as AidpKnowledgeBaseItem;
          setSelectedKb(refreshed);
          setActiveKbDetail(detail);
          setKbs((current) =>
            current.map((kb) => (kb.kds_id === activeKbId ? refreshed : kb))
          );
        })
        .catch((error) =>
          log.error("Failed to refresh active AIDP KB detail:", error)
        );
    }
  }, [activeKbId, fetchDocs, selectedKb]);

  // Active KB item is stored in `selectedKb` state (not derived from `kbs`),
  // because the KB list is server-paginated and refetching it after upload
  // returns only the current page — which may not contain the active KB.
  const activeKbItem = selectedKb;

  return (
    <div
      className="w-full h-full mx-auto relative flex flex-col"
      style={{
        maxWidth: SETUP_PAGE_CONTAINER.MAX_WIDTH,
        padding: `0 ${SETUP_PAGE_CONTAINER.HORIZONTAL_PADDING}`,
      }}
    >
      {/* Two-column layout — content-sized cards with a single
          scroll container; no card stretches to viewport height. */}
      <div className="flex-1 min-h-0 w-full mt-4 overflow-y-auto">
        <Row className="w-full" gutter={TWO_COLUMN_LAYOUT.GUTTER}>
          {/* Left column: KB list */}
          <Col
            xs={TWO_COLUMN_LAYOUT.LEFT_COLUMN.xs}
            md={TWO_COLUMN_LAYOUT.LEFT_COLUMN.md}
            lg={TWO_COLUMN_LAYOUT.LEFT_COLUMN.lg}
            xl={TWO_COLUMN_LAYOUT.LEFT_COLUMN.xl}
            xxl={TWO_COLUMN_LAYOUT.LEFT_COLUMN.xxl}
          >
            <AidpKnowledgeList
              kbs={kbs}
              activeKbId={activeKbId}
              isLoading={loadingKbs}
              total={kbTotal}
              totalReliable={kbTotalReliable}
              hasMore={kbHasMore}
              currentPage={kbPage}
              pageSize={KB_PAGE_SIZE}
              keyword={kbKeyword}
              onKeywordChange={setKbKeyword}
              onPageChange={(page) => fetchKbs(page, debouncedKbKeyword)}
              onSelect={handleSelectKb}
              onRefresh={() => fetchKbs(kbPage, debouncedKbKeyword)}
              onCreateNew={() => setCreateModalOpen(true)}
              onEdit={handleEditKb}
              onDelete={handleDeleteKb}
            />
          </Col>

          {/* Right column: Document list or empty state */}
          <Col
            xs={TWO_COLUMN_LAYOUT.RIGHT_COLUMN.xs}
            md={TWO_COLUMN_LAYOUT.RIGHT_COLUMN.md}
            lg={TWO_COLUMN_LAYOUT.RIGHT_COLUMN.lg}
            xl={TWO_COLUMN_LAYOUT.RIGHT_COLUMN.xl}
            xxl={TWO_COLUMN_LAYOUT.RIGHT_COLUMN.xxl}
          >
            {activeKbItem ? (
              <AidpDocumentList
                activeKb={activeKbItem}
                documents={documents}
                totalDocs={totalDocs}
                totalReliable={docTotalReliable}
                hasMore={docHasMore}
                isLoading={loadingDocs}
                currentPage={docPage}
                pageSize={DOC_PAGE_SIZE}
                onPageChange={(page) => fetchDocs(activeKbId!, page)}
                onDocsUploaded={handleDocsUploaded}
                onRefresh={handleDocsUploaded}
              />
            ) : (
              <div
                className={`${STANDARD_CARD.BASE_CLASSES} w-full`}
                style={{ padding: STANDARD_CARD.PADDING }}
              >
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="text-gray-400 mb-2">
                      <InfoCircleFilled
                        style={{ fontSize: 36, color: "#1677ff" }}
                      />
                    </div>
                    <h3 className="text-base font-medium text-gray-700 mb-1">
                      {t("aidpKnowledge.selectKbTitle")}
                    </h3>
                    <p className="text-gray-500 max-w-md text-xs">
                      {t("aidpKnowledge.selectKbHint")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </Col>
        </Row>
      </div>

      {/* Create KB Modal */}
      <AidpCreateKbModal
        open={createModalOpen}
        existingKbs={kbs}
        onCancel={() => setCreateModalOpen(false)}
        onSuccess={handleCreateKbSuccess}
      />

      {/* Update KB Modal */}
      <AidpUpdateKbModal
        open={updateModalOpen}
        knowledgeBase={editingKb}
        onCancel={() => {
          setUpdateModalOpen(false);
          setEditingKb(null);
        }}
        onSuccess={handleUpdateKbSuccess}
      />
    </div>
  );
};

export default AidpKnowledgeConfiguration;
