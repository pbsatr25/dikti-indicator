

/**
 * Interface untuk Knowledge Retriever (RAG).
 * Ini antarmuka yang akan diimplementasi oleh AI engineer lain.
 */
export interface KnowledgeRetriever {
  /**
   * Cari informasi tentang IKU dari knowledge base.
   * @param query Query pencarian (misal: "definisi IKU 003", "aturan IKU 005")
   * @returns List of chunks with text dan source
   */
  search(query: string): Promise<{ chunks: { text: string; source: string }[] }>;
}

/**
 * Implementasi KnowledgeRetriever menggunakan RAG service.
 */
export class RagKnowledgeRetriever implements KnowledgeRetriever {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_query: string): Promise<{ chunks: { text: string; source: string }[] }> {
    try {
      // Note: RAG service saat ini hanya support via /v1/answer.
      // Endpoint search terpisah akan diimplementasi oleh AI engineer RAG.
      return { chunks: [] };
    } catch (error) {
      console.warn("RAG service tidak tersedia untuk search:", error);
      return { chunks: [] };
    }
  }
}

// Export singleton
export const knowledgeRetriever = new RagKnowledgeRetriever();
