import { isDefined } from '@superset-ui/core';
import {
  SupersetClient,
  SupersetClientInterface,
  RequestConfig,
  Json,
  SupersetClientClass,
} from '@superset-ui/connection';
import getChartBuildQueryRegistry from '../registries/ChartBuildQueryRegistrySingleton';
import { FormData, AnnotationLayerMetadata } from '../query/FormData';

export type SliceIdAndOrFormData =
  | {
      sliceId: number;
      formData?: Partial<FormData>;
    }
  | {
      formData: FormData;
    };

interface AnnotationData {
  [key: string]: object;
}

interface ChartData {
  annotationData: AnnotationData;
  datasource: object;
  formData: FormData;
  queryData: object;
}

export interface ChartClientConfig {
  client?: SupersetClientInterface | SupersetClientClass;
}

export class ChartClient {
  readonly client: SupersetClientInterface | SupersetClientClass;

  constructor(config: ChartClientConfig = {}) {
    const { client = SupersetClient } = config;
    this.client = client;
  }

  loadFormData(input: SliceIdAndOrFormData, options?: RequestConfig): Promise<FormData> {
    /* If sliceId is provided, use it to fetch stored formData from API */
    if ('sliceId' in input) {
      const promise = this.client
        .get({
          endpoint: `/api/v1/formData/?slice_id=${input.sliceId}`,
          ...options,
        } as RequestConfig)
        .then(response => response.json as Json)
        .then(json => json.form_data);

      /*
       * If formData is also specified, override API result
       * with user-specified formData
       */
      return promise.then((dbFormData: FormData) => ({
        ...dbFormData,
        ...input.formData,
      }));
    }

    /* If sliceId is not provided, returned formData wrapped in a Promise */
    return input.formData
      ? Promise.resolve(input.formData as FormData)
      : Promise.reject(new Error('At least one of sliceId or formData must be specified'));
  }

  loadQueryData(formData: FormData, options?: RequestConfig): Promise<object> {
    const buildQuery = getChartBuildQueryRegistry().get(formData.viz_type);
    if (buildQuery) {
      return this.client
        .post({
          endpoint: '/api/v1/query/',
          postPayload: { query_context: buildQuery(formData) },
          ...options,
        } as RequestConfig)
        .then(response => response.json as Json);
    }

    return Promise.reject(new Error(`Unknown chart type: ${formData.viz_type}`));
  }

  loadDatasource(datasourceKey: string, options?: RequestConfig): Promise<object> {
    return this.client
      .get({
        endpoint: `/superset/fetch_datasource_metadata?datasourceKey=${datasourceKey}`,
        ...options,
      } as RequestConfig)
      .then(response => response.json as Json);
  }

  loadAnnotation(annotationLayer: AnnotationLayerMetadata): Promise<object> {
    /* When annotation does not require query */
    if (!isDefined(annotationLayer.sourceType)) {
      return Promise.resolve({});
    }

    // TODO: Implement
    return Promise.reject(new Error('This feature is not implemented yet.'));
  }

  loadAnnotations(annotationLayers?: Array<AnnotationLayerMetadata>): Promise<AnnotationData> {
    if (Array.isArray(annotationLayers) && annotationLayers.length > 0) {
      return Promise.all(annotationLayers.map(layer => this.loadAnnotation(layer))).then(results =>
        annotationLayers.reduce((prev, layer, i) => {
          const output: AnnotationData = prev;
          output[layer.name] = results[i];

          return output;
        }, {}),
      );
    }

    return Promise.resolve({});
  }

  loadChartData(input: SliceIdAndOrFormData): Promise<ChartData> {
    return this.loadFormData(input).then(formData =>
      Promise.all([
        this.loadAnnotations(formData.annotation_layers),
        this.loadDatasource(formData.datasource),
        this.loadQueryData(formData),
      ]).then(([annotationData, datasource, queryData]) => ({
        annotationData,
        datasource,
        formData,
        queryData,
      })),
    );
  }
}
