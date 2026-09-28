import { z } from "zod";

/**
 * Registers all Kaggle tools on an MCP server instance.
 * Each tool returns MCP-shaped content: { content: [{ type: "text", text }] }
 */
export function registerKaggleTools(mcpServer, kaggle) {
  const asText = (data) => ({
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  });

  mcpServer.registerTool(
    "list_competitions",
    {
      title: "List Kaggle competitions",
      description:
        "Search/list Kaggle competitions. Use `search` for a keyword, `group` to scope to ones you've entered.",
      inputSchema: {
        search: z.string().optional().describe("Keyword search, e.g. 'soil grain size'"),
        group: z.enum(["general", "entered", "inClass"]).optional(),
        category: z
          .enum(["all", "featured", "research", "recruitment", "gettingStarted", "masters", "playground"])
          .optional(),
        sortBy: z
          .enum(["grouped", "prize", "earliestDeadline", "latestDeadline", "numberOfTeams", "recentlyCreated"])
          .optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ search, group, category, sortBy, page }) => {
      const data = await kaggle.listCompetitions({ search, group, category, sortBy, page });
      return asText(data);
    }
  );

  mcpServer.registerTool(
    "get_leaderboard",
    {
      title: "Get competition leaderboard",
      description: "View the public leaderboard for a Kaggle competition (by its URL slug).",
      inputSchema: {
        competitionId: z.string().describe("Competition slug, e.g. 'soil-grain-size-from-photos'"),
      },
    },
    async ({ competitionId }) => asText(await kaggle.viewLeaderboard(competitionId))
  );

  mcpServer.registerTool(
    "list_submissions",
    {
      title: "List your submissions",
      description: "List your own submission history + scores for a competition.",
      inputSchema: {
        competitionId: z.string(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ competitionId, page }) => asText(await kaggle.listSubmissions(competitionId, page))
  );

  mcpServer.registerTool(
    "list_competition_files",
    {
      title: "List competition data files",
      description: "List the data files available for a competition.",
      inputSchema: { competitionId: z.string() },
    },
    async ({ competitionId }) => asText(await kaggle.listCompetitionDataFiles(competitionId))
  );

  mcpServer.registerTool(
    "download_competition_file",
    {
      title: "Download a competition data file",
      description:
        "Download one file from a competition's dataset. Returns raw bytes decoded as UTF-8 text — only use for text/CSV files, not binary/image archives.",
      inputSchema: { competitionId: z.string(), fileName: z.string() },
    },
    async ({ competitionId, fileName }) => {
      const buf = await kaggle.downloadCompetitionDataFile(competitionId, fileName);
      return { content: [{ type: "text", text: buf.toString("utf-8") }] };
    }
  );

  mcpServer.registerTool(
    "submit_prediction",
    {
      title: "Submit a prediction to a competition",
      description:
        "Submit predictions to a Kaggle competition. Pass the full CSV content as text " +
        "(not a file path — this server has no access to your local filesystem).",
      inputSchema: {
        competitionId: z.string(),
        fileName: z.string().describe("e.g. 'submission.csv'"),
        fileContent: z.string().describe("Full contents of the submission file, as text"),
        submissionDescription: z.string().describe("Short message describing this submission"),
      },
    },
    async ({ competitionId, fileName, fileContent, submissionDescription }) => {
      const result = await kaggle.submitPrediction(
        competitionId,
        fileName,
        fileContent,
        submissionDescription
      );
      return asText(result);
    }
  );

  mcpServer.registerTool(
    "list_kernels",
    {
      title: "List/search Kaggle notebooks (kernels)",
      description: "Search public kernels, or your own with group='profile'.",
      inputSchema: {
        search: z.string().optional(),
        competition: z.string().optional().describe("Filter to kernels using this competition"),
        dataset: z.string().optional().describe("Filter to kernels using this dataset, 'owner/slug'"),
        group: z.enum(["everyone", "profile", "upvoted"]).optional(),
        language: z.enum(["all", "python", "r", "sqlite", "julia"]).optional(),
        kernelType: z.enum(["all", "script", "notebook"]).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async (params) => asText(await kaggle.listKernels(params))
  );

  mcpServer.registerTool(
    "get_kernel_status",
    {
      title: "Get notebook run status",
      description:
        "Check whether a kernel/notebook run has finished (queued/running/complete/error). Poll this after push_kernel.",
      inputSchema: { userName: z.string(), kernelSlug: z.string() },
    },
    async ({ userName, kernelSlug }) => asText(await kaggle.kernelStatus(userName, kernelSlug))
  );

  mcpServer.registerTool(
    "get_kernel_output",
    {
      title: "Get notebook output",
      description: "Fetch the log output and any result files from the latest run of a kernel/notebook.",
      inputSchema: { userName: z.string(), kernelSlug: z.string() },
    },
    async ({ userName, kernelSlug }) => asText(await kaggle.kernelOutput(userName, kernelSlug))
  );

  mcpServer.registerTool(
    "pull_kernel",
    {
      title: "Pull notebook source",
      description: "Fetch the current source code and metadata of an existing kernel/notebook.",
      inputSchema: { userName: z.string(), kernelSlug: z.string() },
    },
    async ({ userName, kernelSlug }) => asText(await kaggle.kernelPull(userName, kernelSlug))
  );

  mcpServer.registerTool(
    "push_kernel",
    {
      title: "Push and run a notebook/script on Kaggle",
      description:
        "Create or update a kernel with the given source code and trigger a run on Kaggle's infrastructure " +
        "(with GPU if requested). Runs asynchronously — call get_kernel_status to check progress, then " +
        "get_kernel_output once it's complete.",
      inputSchema: {
        slug: z
          .string()
          .describe("'yourusername/kernel-slug' — creates a new kernel, or targets an existing one by name"),
        kernelId: z
          .number()
          .int()
          .optional()
          .describe("Numeric kernel ID (from pull_kernel/list_kernels) to update an existing kernel instead of by slug"),
        newTitle: z.string().optional().describe("Required when creating a new kernel"),
        text: z.string().describe("Full source code (Python/R script, or notebook JSON if kernelType='notebook')"),
        language: z.enum(["python", "r", "rmarkdown"]),
        kernelType: z.enum(["script", "notebook"]),
        isPrivate: z.boolean().optional(),
        enableGpu: z.boolean().optional(),
        enableInternet: z.boolean().optional(),
        datasetDataSources: z.array(z.string()).optional().describe("'owner/dataset-slug' entries"),
        competitionDataSources: z.array(z.string()).optional().describe("Competition slugs"),
        kernelDataSources: z.array(z.string()).optional().describe("'owner/kernel-slug' entries whose output to attach"),
        modelDataSources: z
          .array(z.string())
          .optional()
          .describe(
            "Kaggle models to attach, each as 'owner/model-slug/framework/variation-slug/version', e.g. 'google/gemma/pyTorch/2b/1'"
          ),
      },
    },
    async (params) => asText(await kaggle.kernelPush(params))
  );

  mcpServer.registerTool(
    "get_active_competitions_dashboard",
    {
      title: "Dashboard: all your active competitions",
      description:
        "One-call overview of every competition you're entered in, with deadline and your latest submission's " +
        "score/status for each. Use this instead of checking competitions one by one.",
      inputSchema: {},
    },
    async () => asText(await kaggle.getActiveCompetitionsDashboard())
  );

  mcpServer.registerTool(
    "create_dataset",
    {
      title: "Create a new Kaggle dataset",
      description: "Publish a new dataset from a single text/CSV file.",
      inputSchema: {
        title: z.string(),
        slug: z.string().optional(),
        ownerSlug: z.string().describe("Your Kaggle username"),
        licenseName: z.string().optional().default("unknown"),
        subtitle: z.string().optional(),
        description: z.string().optional(),
        isPrivate: z.boolean().optional().default(true),
        fileName: z.string(),
        fileContent: z.string(),
      },
    },
    async (params) => asText(await kaggle.createDataset(params))
  );

  mcpServer.registerTool(
    "create_dataset_version",
    {
      title: "Publish a new dataset version",
      description: "Update an existing dataset you own with a new file.",
      inputSchema: {
        ownerSlug: z.string(),
        datasetSlug: z.string(),
        versionNotes: z.string(),
        fileName: z.string(),
        fileContent: z.string(),
        deleteOldVersions: z.boolean().optional().default(false),
      },
    },
    async ({ ownerSlug, datasetSlug, ...rest }) =>
      asText(await kaggle.createDatasetVersion(ownerSlug, datasetSlug, rest))
  );

  mcpServer.registerTool(
    "get_dataset_status",
    {
      title: "Check dataset processing status",
      description: "Poll after create_dataset/create_dataset_version to see when Kaggle finishes processing it.",
      inputSchema: { ownerSlug: z.string(), datasetSlug: z.string() },
    },
    async ({ ownerSlug, datasetSlug }) => asText(await kaggle.getDatasetStatus(ownerSlug, datasetSlug))
  );

  mcpServer.registerTool(
    "list_models",
    {
      title: "List/search Kaggle models",
      description: "Search public Kaggle models (pretrained weights, etc).",
      inputSchema: { search: z.string().optional(), page: z.number().int().min(1).optional() },
    },
    async (params) => asText(await kaggle.listModels(params))
  );

  mcpServer.registerTool(
    "get_model",
    {
      title: "Get a model's details",
      description: "Get metadata for a specific Kaggle model.",
      inputSchema: { ownerSlug: z.string(), modelSlug: z.string() },
    },
    async ({ ownerSlug, modelSlug }) => asText(await kaggle.getModel(ownerSlug, modelSlug))
  );

  mcpServer.registerTool(
    "create_model",
    {
      title: "Create a new Kaggle model listing",
      description: "Create a new model entry (metadata only — attach instance/weight files afterward on kaggle.com).",
      inputSchema: {
        ownerSlug: z.string(),
        slug: z.string(),
        title: z.string(),
        subtitle: z.string().optional(),
        isPrivate: z.boolean().optional().default(true),
        description: z.string().optional(),
      },
    },
    async (params) => asText(await kaggle.createModel(params))
  );

  mcpServer.registerTool(
    "delete_model",
    {
      title: "Delete a Kaggle model",
      description: "Permanently delete a model you own. Irreversible.",
      inputSchema: { ownerSlug: z.string(), modelSlug: z.string() },
    },
    async ({ ownerSlug, modelSlug }) => asText(await kaggle.deleteModel(ownerSlug, modelSlug))
  );

  mcpServer.registerTool(
    "list_datasets",
    {
      title: "List/search Kaggle datasets",
      description: "Search public Kaggle datasets.",
      inputSchema: {
        search: z.string().optional(),
        sortBy: z.enum(["hottest", "votes", "updated", "active"]).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ search, sortBy, page }) => asText(await kaggle.listDatasets({ search, sortBy, page }))
  );

  mcpServer.registerTool(
    "list_dataset_files",
    {
      title: "List files in a dataset",
      description: "List the files inside a specific Kaggle dataset.",
      inputSchema: { ownerSlug: z.string(), datasetSlug: z.string() },
    },
    async ({ ownerSlug, datasetSlug }) => asText(await kaggle.listDatasetFiles(ownerSlug, datasetSlug))
  );

  mcpServer.registerTool(
    "download_dataset_file",
    {
      title: "Download a dataset file",
      description:
        "Download one file from a dataset. Returns content decoded as UTF-8 text — only use for text/CSV files.",
      inputSchema: { ownerSlug: z.string(), datasetSlug: z.string(), fileName: z.string() },
    },
    async ({ ownerSlug, datasetSlug, fileName }) => {
      const buf = await kaggle.downloadDatasetFile(ownerSlug, datasetSlug, fileName);
      return { content: [{ type: "text", text: buf.toString("utf-8") }] };
    }
  );
}
