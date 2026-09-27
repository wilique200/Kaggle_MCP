import fetch from "node-fetch";
import FormData from "form-data";

const BASE_URL = "https://www.kaggle.com/api/v1";

/**
 * Thin wrapper around the official Kaggle v1 REST API.
 * Auth is HTTP Basic with your Kaggle username + API key
 * (generated at https://www.kaggle.com/settings/account).
 *
 * Endpoint shapes below are taken directly from Kaggle's published
 * swagger spec, not guessed — including the three-step submission
 * flow (get upload URL -> upload blob -> submit with token).
 */
export class KaggleClient {
  constructor({ username, key }) {
    if (!username || !key) {
      throw new Error(
        "Kaggle credentials missing: set KAGGLE_USERNAME and KAGGLE_KEY."
      );
    }
    this.authHeader =
      "Basic " + Buffer.from(`${username}:${key}`).toString("base64");
  }

  async _request(path, { method = "GET", query, form, isMultipart, json } = {}) {
    let url = `${BASE_URL}${path}`;
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null)
      ).toString();
      if (qs) url += `?${qs}`;
    }

    const headers = { Authorization: this.authHeader };
    let body;

    if (json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    } else if (isMultipart) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form || {})) {
        if (v === undefined || v === null) continue;
        if (v && v.buffer) {
          // file field: { buffer, filename }
          fd.append(k, v.buffer, { filename: v.filename });
        } else {
          fd.append(k, String(v));
        }
      }
      body = fd;
      Object.assign(headers, fd.getHeaders());
    }

    const res = await fetch(url, { method, headers, body });
    const contentType = res.headers.get("content-type") || "";

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Kaggle API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`
      );
    }

    if (contentType.includes("application/json")) {
      return res.json();
    }
    // Binary/file responses (dataset & competition file downloads)
    return res.buffer();
  }

  // ---- Competitions ----

  listCompetitions({ group, category, sortBy, page, search } = {}) {
    return this._request("/competitions/list", {
      query: { group, category, sortBy, page, search },
    });
  }

  listSubmissions(competitionId, page = 1) {
    return this._request(`/competitions/submissions/list/${competitionId}`, {
      query: { page },
    });
  }

  viewLeaderboard(competitionId) {
    return this._request(`/competitions/${competitionId}/leaderboard/view`);
  }

  listCompetitionDataFiles(competitionId) {
    return this._request(`/competitions/data/list/${competitionId}`);
  }

  downloadCompetitionDataFile(competitionId, fileName) {
    return this._request(
      `/competitions/data/download/${competitionId}/${encodeURIComponent(
        fileName
      )}`
    );
  }

  /** Step 1 of 3: ask Kaggle where to upload the submission file. */
  getSubmissionUploadUrl(competitionId, fileName, contentLength, lastModifiedDateUtc) {
    return this._request(
      `/competitions/${competitionId}/submissions/url/${contentLength}/${lastModifiedDateUtc}`,
      { method: "POST", isMultipart: true, form: { fileName } }
    );
  }

  /** Step 2 of 3: upload the actual file bytes to the guid Kaggle handed back. */
  uploadSubmissionFile(guid, contentLength, lastModifiedDateUtc, fileBuffer, fileName) {
    return this._request(
      `/competitions/submissions/upload/${guid}/${contentLength}/${lastModifiedDateUtc}`,
      {
        method: "POST",
        isMultipart: true,
        form: { file: { buffer: fileBuffer, filename: fileName } },
      }
    );
  }

  /** Step 3 of 3: finalize the submission with the returned blob token. */
  submitToCompetition(competitionId, blobFileTokens, submissionDescription) {
    return this._request(`/competitions/submissions/submit/${competitionId}`, {
      method: "POST",
      isMultipart: true,
      form: { blobFileTokens, submissionDescription },
    });
  }

  /** High-level helper: runs all three submission steps for a text/CSV payload. */
  async submitPrediction(competitionId, fileName, fileContent, submissionDescription) {
    const buffer = Buffer.from(fileContent, "utf-8");
    const contentLength = buffer.byteLength;
    const lastModifiedDateUtc = Math.floor(Date.now() / 1000);

    const urlResp = await this.getSubmissionUploadUrl(
      competitionId,
      fileName,
      contentLength,
      lastModifiedDateUtc
    );
    // Kaggle returns { createUrl, token } (field names per current API).
    const guid = urlResp.token || urlResp.guid || urlResp.createUrl;
    if (!guid) {
      throw new Error(
        `Unexpected response from submissions/url endpoint: ${JSON.stringify(urlResp)}`
      );
    }

    await this.uploadSubmissionFile(
      guid,
      contentLength,
      lastModifiedDateUtc,
      buffer,
      fileName
    );

    return this.submitToCompetition(competitionId, guid, submissionDescription);
  }

  // ---- Kernels (Notebooks) ----

  listKernels(params = {}) {
    return this._request("/kernels/list", { query: params });
  }

  kernelStatus(userName, kernelSlug) {
    return this._request("/kernels/status", { query: { userName, kernelSlug } });
  }

  kernelOutput(userName, kernelSlug) {
    return this._request("/kernels/output", { query: { userName, kernelSlug } });
  }

  kernelPull(userName, kernelSlug) {
    return this._request("/kernels/pull", { query: { userName, kernelSlug } });
  }

  /**
   * Push (create or update) a kernel/notebook and trigger a run.
   * Kaggle runs it asynchronously — poll kernelStatus() afterward.
   *
   * `slug` (string, "username/kernel-slug") creates a new kernel or targets
   * an existing one by name. `kernelId` (integer, from pull_kernel/list_kernels)
   * updates an existing kernel by its numeric ID instead — if both are given,
   * Kaggle prefers kernelId. Passing a slug string into an `id` field is what
   * caused "Could not convert string to integer" — id must be a real integer.
   */
  kernelPush({
    slug,
    kernelId,
    newTitle,
    text,
    language,
    kernelType,
    isPrivate = true,
    enableGpu = false,
    enableInternet = false,
    datasetDataSources = [],
    competitionDataSources = [],
    kernelDataSources = [],
    categoryIds = [],
  }) {
    return this._request("/kernels/push", {
      method: "POST",
      json: {
        id: kernelId ? Number(kernelId) : undefined,
        slug,
        newTitle,
        text,
        language,
        kernelType,
        isPrivate,
        enableGpu,
        enableInternet,
        datasetDataSources,
        competitionDataSources,
        kernelDataSources,
        categoryIds,
      },
    });
  }

  // ---- Datasets ----

  listDatasets(params = {}) {
    return this._request("/datasets/list", { query: params });
  }

  listDatasetFiles(ownerSlug, datasetSlug, datasetVersionNumber) {
    return this._request(`/datasets/list/${ownerSlug}/${datasetSlug}`, {
      query: { datasetVersionNumber },
    });
  }

  downloadDatasetFile(ownerSlug, datasetSlug, fileName, datasetVersionNumber) {
    return this._request(
      `/datasets/download/${ownerSlug}/${datasetSlug}/${encodeURIComponent(
        fileName
      )}`,
      { query: { datasetVersionNumber } }
    );
  }

  /** Upload one file's bytes and get back a token to reference it in create/version calls. */
  async _uploadDatasetFileBlob(fileBuffer, fileName) {
    const contentLength = fileBuffer.byteLength;
    const lastModifiedDateUtc = Math.floor(Date.now() / 1000);
    const resp = await this._request(
      `/datasets/upload/file/${contentLength}/${lastModifiedDateUtc}`,
      { method: "POST", isMultipart: true, form: { fileName } }
    );
    // Response carries the blob upload URL/token; then the actual bytes go up.
    const uploadUrl = resp.createUrl || resp.url;
    const token = resp.token;
    if (uploadUrl) {
      await fetch(uploadUrl, { method: "PUT", body: fileBuffer });
    }
    if (!token) {
      throw new Error(`Unexpected dataset upload response: ${JSON.stringify(resp)}`);
    }
    return token;
  }

  /** Create a brand-new dataset from one text/CSV file. */
  async createDataset({
    title,
    slug,
    ownerSlug,
    licenseName = "unknown",
    subtitle,
    description,
    isPrivate = true,
    fileName,
    fileContent,
  }) {
    const buffer = Buffer.from(fileContent, "utf-8");
    const token = await this._uploadDatasetFileBlob(buffer, fileName);
    return this._request("/datasets/create/new", {
      method: "POST",
      json: {
        title,
        slug,
        ownerSlug,
        licenseName,
        subtitle,
        description,
        isPrivate,
        files: [{ token }],
      },
    });
  }

  /** Publish a new version of an existing dataset with an updated file. */
  async createDatasetVersion(ownerSlug, datasetSlug, { versionNotes, fileName, fileContent, deleteOldVersions = false }) {
    const buffer = Buffer.from(fileContent, "utf-8");
    const token = await this._uploadDatasetFileBlob(buffer, fileName);
    return this._request(`/datasets/create/version/${ownerSlug}/${datasetSlug}`, {
      method: "POST",
      json: { versionNotes, files: [{ token }], deleteOldVersions },
    });
  }

  getDatasetStatus(ownerSlug, datasetSlug) {
    return this._request(`/datasets/status/${ownerSlug}/${datasetSlug}`);
  }

  // ---- Models ----
  // NOTE: field names here come from third-party documentation of Kaggle's
  // internal API, not the published swagger spec. Less certain than the
  // competitions/datasets/kernels methods above — if a call fails with a
  // validation error, that error will name the field to fix.

  listModels(params = {}) {
    return this._request("/models/list", { query: params });
  }

  getModel(ownerSlug, modelSlug) {
    return this._request(`/models/${ownerSlug}/${modelSlug}/get`);
  }

  createModel({ ownerSlug, slug, title, subtitle, isPrivate = true, description, publishTime }) {
    return this._request("/models/create/new", {
      method: "POST",
      json: { ownerSlug, slug, title, subtitle, isPrivate, description, publishTime },
    });
  }

  deleteModel(ownerSlug, modelSlug) {
    return this._request(`/models/${ownerSlug}/${modelSlug}/delete`, { method: "POST" });
  }

  // ---- Productivity extra: cross-competition dashboard ----

  /**
   * Not a Kaggle endpoint — a convenience aggregator. Pulls every competition
   * you've entered plus your latest submission for each, in one call, so you
   * don't have to ask separately per competition.
   */
  async getActiveCompetitionsDashboard() {
    const entered = await this.listCompetitions({ group: "entered" });
    const list = Array.isArray(entered) ? entered : entered.results || [];

    const rows = await Promise.all(
      list.map(async (comp) => {
        // listCompetitions returns `ref` as a full URL
        // (https://www.kaggle.com/competitions/slug-name), but the
        // submissions endpoint needs just the slug — extract it.
        const rawRef = comp.ref || comp.id || comp.competitionId || "";
        const ref = rawRef.split("/").filter(Boolean).pop();
        let latestSubmission = null;
        try {
          const subs = await this.listSubmissions(ref, 1);
          const subList = Array.isArray(subs) ? subs : subs.submissions || [];
          latestSubmission = subList[0] || null;
        } catch (e) {
          latestSubmission = { error: e.message };
        }
        return {
          competition: ref,
          title: comp.title,
          deadline: comp.deadline,
          category: comp.category,
          latestSubmission,
        };
      })
    );

    return rows;
  }
}
