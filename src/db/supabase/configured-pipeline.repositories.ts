import "server-only";

import type { Environment } from "../../lib/config/env";
import type {
  SupabaseContentPersistenceRepository,
  SupabaseDailyRunRepository,
  SupabaseModelInvocationRepository,
  SupabasePipelineWorkspaceRepository,
  SupabasePublicationHistoryRepository,
  SupabasePipelineWorkspaceWriteAuthorityProvider,
  SupabasePublicationPostMapper,
  SupabasePublishReceiptRepository,
  SupabasePublisherRepository,
  SupabaseSourceAttemptRepository,
  SupabaseArticleFullTextRepository,
  SupabaseEditorialMaterialsRepository,
} from "../../repositories";
import { createConfiguredSupabaseDailyRunRepository } from "./configured-daily-run.repository";
import {
  createConfiguredSupabaseContentPersistenceRepository,
  createConfiguredSupabaseModelInvocationRepository,
  createConfiguredSupabasePipelineWorkspaceRepository,
  createConfiguredSupabasePublicationHistoryRepository,
  createConfiguredSupabasePublishReceiptRepository,
  createConfiguredSupabasePublisherRepository,
  createConfiguredSupabaseSourceAttemptRepository,
  createConfiguredSupabaseArticleFullTextRepository,
  createConfiguredSupabaseEditorialMaterialsRepository,
} from "./configured-write.repositories";

export interface ConfiguredSupabasePipelineRepositories {
  dailyRun: SupabaseDailyRunRepository;
  contentPersistence: SupabaseContentPersistenceRepository;
  workspace: SupabasePipelineWorkspaceRepository;
  sourceAttempt: SupabaseSourceAttemptRepository;
  modelInvocation: SupabaseModelInvocationRepository;
  publisher: SupabasePublisherRepository;
  publishReceipt: SupabasePublishReceiptRepository;
  publicationHistory: SupabasePublicationHistoryRepository;
  articleFullText: SupabaseArticleFullTextRepository;
  editorialMaterials: SupabaseEditorialMaterialsRepository;
}

/** Creates server-only clients lazily; no RPC or network call occurs here. */
export function createConfiguredSupabasePipelineRepositories(
  environment: Environment,
  options: Readonly<{
    writeAuthority: SupabasePipelineWorkspaceWriteAuthorityProvider;
    publicationPostMapper: SupabasePublicationPostMapper;
  }>,
): ConfiguredSupabasePipelineRepositories {
  return Object.freeze({
    dailyRun: createConfiguredSupabaseDailyRunRepository(environment),
    contentPersistence:
      createConfiguredSupabaseContentPersistenceRepository(environment),
    workspace: createConfiguredSupabasePipelineWorkspaceRepository(
      environment,
      options,
    ),
    sourceAttempt: createConfiguredSupabaseSourceAttemptRepository(environment),
    modelInvocation:
      createConfiguredSupabaseModelInvocationRepository(environment),
    publisher: createConfiguredSupabasePublisherRepository(environment),
    publishReceipt:
      createConfiguredSupabasePublishReceiptRepository(environment),
    publicationHistory:
      createConfiguredSupabasePublicationHistoryRepository(environment),
    articleFullText:
      createConfiguredSupabaseArticleFullTextRepository(environment),
    editorialMaterials:
      createConfiguredSupabaseEditorialMaterialsRepository(environment),
  });
}
