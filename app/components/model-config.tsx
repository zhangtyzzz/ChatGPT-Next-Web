import {
  ServiceProvider,
  OpenaiPath,
  SiliconFlow,
  OPENAI_BASE_URL,
} from "@/app/constant";
import { ModalConfigValidator, ModelConfig } from "../store";
import { useAccessStore, useAppConfig } from "../store";

import Locale from "../locales";
import { InputRange } from "./input-range";
import { ListItem, Select, showToast, showModal } from "./ui-lib";
import { useAllModels } from "../utils/hooks";
import styles from "./model-config.module.scss";
import { getModelProvider } from "../utils/model";
import { useEffect, useState, useCallback } from "react";
import { getHeaders } from "../client/api";
import { getClientConfig } from "../config/client";
import { ApiPath } from "@/app/constant";

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
}) {
  const allModels = useAllModels();
  const accessStore = useAccessStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const appConfig = useAppConfig();

  // 确保初始化时providerName和模型匹配
  useEffect(() => {
    // 确保allModels已加载
    if (!allModels || allModels.length === 0) return;

    // 检查当前选中的模型是否确实属于当前选中的服务商
    const modelBelongsToProvider = allModels.some(
      (m) =>
        m.available &&
        m.name === props.modelConfig.model &&
        m.provider?.providerName === props.modelConfig.providerName,
    );

    // 如果不匹配，则强制更新为当前服务商的第一个可用模型
    if (!modelBelongsToProvider) {
      console.log(
        `模型不匹配修复: 当前模型 ${props.modelConfig.model} 不属于 ${props.modelConfig.providerName}`,
      );

      // 找到当前服务商的第一个可用模型
      const firstModelForProvider = allModels.find(
        (m) =>
          m.available &&
          m.provider?.providerName === props.modelConfig.providerName,
      );

      if (firstModelForProvider) {
        console.log(`模型不匹配修复: 更新为 ${firstModelForProvider.name}`);
        props.updateConfig((config) => {
          config.model = ModalConfigValidator.model(firstModelForProvider.name);
        });
      } else if (props.modelConfig.providerName === ServiceProvider.OpenAI) {
        // 如果是OpenAI但没找到模型，强制设置为一个OpenAI常见模型
        const openAIModel = "gpt-4o-mini";
        console.log(
          `模型不匹配修复: 未找到OpenAI模型，默认设置为 ${openAIModel}`,
        );
        props.updateConfig((config) => {
          config.model = ModalConfigValidator.model(openAIModel);
        });
      }
    }
  }, [props.modelConfig.providerName, props.modelConfig.model, allModels]);

  // 过滤未配置API密钥的服务提供商
  const validProviders = Object.entries(ServiceProvider);

  // 确保有可用的模型供当前服务商使用
  const filteredModels = allModels.filter(
    (v) =>
      v.available &&
      v.provider?.providerName === props.modelConfig.providerName,
  );

  // 如果没有找到当前服务商的模型，显示所有可用模型（防止下拉列表为空）
  const modelsToShow =
    filteredModels.length > 0
      ? filteredModels
      : allModels.filter((v) => v.available);

  const value = `${props.modelConfig.model}@${props.modelConfig?.providerName}`;
  const compressModelValue = `${props.modelConfig.compressModel}@${props.modelConfig?.compressProviderName}`;

  // 从当前服务商获取可用模型列表
  const refreshModels = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // 获取当前服务商
      const provider = props.modelConfig.providerName;

      // 获取API路径和模型列表路径
      let baseUrl = "";
      let listModelPath = "";

      switch (provider) {
        case ServiceProvider.OpenAI:
          baseUrl = accessStore.openaiUrl;
          listModelPath = OpenaiPath.ListModelPath;
          break;
        case ServiceProvider.SiliconFlow:
          baseUrl = accessStore.siliconflowUrl;
          listModelPath = SiliconFlow.ListModelPath;
          break;
        // 如果需要为其他服务商添加支持，可以在这里继续添加
        default:
          showToast(`暂不支持${provider}的模型列表获取`);
          setIsRefreshing(false);
          return;
      }

      // 与聊天功能使用相同的方式构建API路径
      if (baseUrl.length === 0) {
        const isApp = !!getClientConfig()?.isApp;
        const apiPath = ApiPath.OpenAI;
        baseUrl = isApp ? OPENAI_BASE_URL : apiPath;
      }

      if (baseUrl.endsWith("/")) {
        baseUrl = baseUrl.slice(0, baseUrl.length - 1);
      }

      if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.OpenAI)) {
        baseUrl = "https://" + baseUrl;
      }

      const endpoint = `${baseUrl}/${listModelPath}`;
      console.log(`正在从 ${endpoint} 获取模型列表...`);

      // 直接使用getHeaders()函数获取包含认证信息的头部
      const response = await fetch(endpoint, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      let models = [];

      // 统一处理返回的模型数据
      if (provider === ServiceProvider.OpenAI) {
        models = data.data.map((m: any, index: number) => ({
          name: m.id,
          displayName: m.id,
          available: true,
          sorted: 1000 + index,
          provider: {
            id: "openai",
            providerName: "OpenAI",
            providerType: "openai",
            sorted: 1,
          },
        }));
      } else if (provider === ServiceProvider.SiliconFlow) {
        models = data.data.map((m: any, index: number) => ({
          name: m.id,
          displayName: m.id,
          available: true,
          sorted: 1000 + index,
          provider: {
            id: "siliconflow",
            providerName: "SiliconFlow",
            providerType: "custom",
            sorted: 1,
          },
        }));
      }

      if (!models || models.length === 0) {
        showToast("未获取到可用模型");
        setIsRefreshing(false);
        return;
      }

      showConfirmDialog(models, provider);
    } catch (error) {
      console.error("刷新模型列表失败", error);
      showToast("刷新模型列表失败");
      setIsRefreshing(false);
    }
  }, [props.modelConfig.providerName, accessStore, appConfig, props]);

  // 显示确认对话框
  const showConfirmDialog = (models: any[], provider: ServiceProvider) => {
    let modalRoot: HTMLElement | null = null;

    const onConfirm = () => {
      // 清除当前服务商的模型
      const filteredModels = appConfig.models.filter(
        (m) => m.provider?.providerName !== provider,
      );

      // 将新模型添加到过滤后的列表，并确保标记为可用
      const updatedModels = [
        ...filteredModels,
        ...models.map((m) => ({ ...m, available: true })),
      ];

      // 更新应用配置
      appConfig.update((config) => {
        config.models = updatedModels;
      });

      // 如果当前选择的模型不在新列表中，自动选择第一个可用模型
      const currentModel = props.modelConfig.model;
      const isCurrentModelInNewList = models.some(
        (m) => m.name === currentModel,
      );

      if (!isCurrentModelInNewList && models.length > 0) {
        props.updateConfig((config) => {
          config.model = ModalConfigValidator.model(models[0].name);
        });
      }

      setIsRefreshing(false);
      showToast(`已更新${provider}的模型列表，共${models.length}个模型`);

      // 关闭弹窗 - 通过触发模态窗口的点击事件
      setTimeout(() => {
        const modalMask = document.querySelector(".modal-mask");
        if (modalMask) {
          const event = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window,
          });
          modalMask.dispatchEvent(event);
        }
      }, 0);
    };

    showModal({
      title: "刷新模型列表",
      children: `获取到 ${models.length} 个模型，是否更新${provider}的模型列表？`,
      onClose: () => {
        setIsRefreshing(false);
      },
      actions: [
        <button
          key="cancel"
          onClick={() => {
            setIsRefreshing(false);

            // 关闭弹窗 - 通过触发模态窗口的点击事件
            setTimeout(() => {
              const modalMask = document.querySelector(".modal-mask");
              if (modalMask) {
                const event = new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                });
                modalMask.dispatchEvent(event);
              }
            }, 0);
          }}
        >
          取消
        </button>,
        <button key="confirm" onClick={onConfirm}>
          确认
        </button>,
      ],
    });

    // 保存模态窗口引用
    modalRoot = document.querySelector(".modal-mask");
  };

  return (
    <>
      <ListItem title={Locale.Settings.Access.Provider.Title}>
        <Select
          aria-label={Locale.Settings.Access.Provider.Title}
          value={props.modelConfig.providerName}
          align="center"
          onChange={(e) => {
            const provider = e.currentTarget.value as ServiceProvider;
            props.updateConfig((config) => {
              config.providerName = provider;
              const firstModelForProvider = allModels.find(
                (m) => m.available && m.provider?.providerName === provider,
              );
              if (firstModelForProvider) {
                config.model = ModalConfigValidator.model(
                  firstModelForProvider.name,
                );
              }
            });
          }}
        >
          {validProviders.map(([k, v]) => (
            <option value={v} key={k}>
              {k}
            </option>
          ))}
        </Select>
      </ListItem>

      <ListItem title={Locale.Settings.Model}>
        <div className={styles["model-selector-container"]}>
          <button
            className={styles["refresh-models-button"]}
            onClick={refreshModels}
            disabled={isRefreshing}
            title="刷新模型列表"
          >
            {isRefreshing ? "⟳" : "↻"}
          </button>
          <Select
            aria-label={Locale.Settings.Model}
            value={value}
            align="center"
            onChange={(e) => {
              const [model, providerName] = getModelProvider(
                e.currentTarget.value,
              );
              props.updateConfig((config) => {
                config.model = ModalConfigValidator.model(model);
                config.providerName = providerName as ServiceProvider;
              });
            }}
          >
            {modelsToShow.map((v, i) => (
              <option value={`${v.name}@${v.provider?.providerName}`} key={i}>
                {v.displayName}
                {filteredModels.length === 0
                  ? ` (${v.provider?.providerName})`
                  : ""}
              </option>
            ))}
          </Select>
        </div>
      </ListItem>
      <ListItem
        title={Locale.Settings.Temperature.Title}
        subTitle={Locale.Settings.Temperature.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.Temperature.Title}
          value={props.modelConfig.temperature?.toFixed(1)}
          min="0"
          max="1" // lets limit it to 0-1
          step="0.1"
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.temperature = ModalConfigValidator.temperature(
                  e.currentTarget.valueAsNumber,
                )),
            );
          }}
        ></InputRange>
      </ListItem>
      <ListItem
        title={Locale.Settings.TopP.Title}
        subTitle={Locale.Settings.TopP.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.TopP.Title}
          value={(props.modelConfig.top_p ?? 1).toFixed(1)}
          min="0"
          max="1"
          step="0.1"
          onChange={(e) => {
            props.updateConfig(
              (config) =>
                (config.top_p = ModalConfigValidator.top_p(
                  e.currentTarget.valueAsNumber,
                )),
            );
          }}
        ></InputRange>
      </ListItem>
      <ListItem
        title={Locale.Settings.MaxTokens.Title}
        subTitle={Locale.Settings.MaxTokens.SubTitle}
      >
        <input
          aria-label={Locale.Settings.MaxTokens.Title}
          type="number"
          min={1024}
          max={512000}
          value={props.modelConfig.max_tokens}
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.max_tokens = ModalConfigValidator.max_tokens(
                  e.currentTarget.valueAsNumber,
                )),
            )
          }
        ></input>
      </ListItem>

      {props.modelConfig?.providerName == ServiceProvider.Google ? null : (
        <>
          <ListItem
            title={Locale.Settings.PresencePenalty.Title}
            subTitle={Locale.Settings.PresencePenalty.SubTitle}
          >
            <InputRange
              aria={Locale.Settings.PresencePenalty.Title}
              value={props.modelConfig.presence_penalty?.toFixed(1)}
              min="-2"
              max="2"
              step="0.1"
              onChange={(e) => {
                props.updateConfig(
                  (config) =>
                    (config.presence_penalty =
                      ModalConfigValidator.presence_penalty(
                        e.currentTarget.valueAsNumber,
                      )),
                );
              }}
            ></InputRange>
          </ListItem>

          <ListItem
            title={Locale.Settings.FrequencyPenalty.Title}
            subTitle={Locale.Settings.FrequencyPenalty.SubTitle}
          >
            <InputRange
              aria={Locale.Settings.FrequencyPenalty.Title}
              value={props.modelConfig.frequency_penalty?.toFixed(1)}
              min="-2"
              max="2"
              step="0.1"
              onChange={(e) => {
                props.updateConfig(
                  (config) =>
                    (config.frequency_penalty =
                      ModalConfigValidator.frequency_penalty(
                        e.currentTarget.valueAsNumber,
                      )),
                );
              }}
            ></InputRange>
          </ListItem>

          <ListItem
            title={Locale.Settings.InjectSystemPrompts.Title}
            subTitle={Locale.Settings.InjectSystemPrompts.SubTitle}
          >
            <input
              aria-label={Locale.Settings.InjectSystemPrompts.Title}
              type="checkbox"
              checked={props.modelConfig.enableInjectSystemPrompts}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.enableInjectSystemPrompts =
                      e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>

          <ListItem
            title={Locale.Settings.InputTemplate.Title}
            subTitle={Locale.Settings.InputTemplate.SubTitle}
          >
            <input
              aria-label={Locale.Settings.InputTemplate.Title}
              type="text"
              value={props.modelConfig.template}
              onChange={(e) =>
                props.updateConfig(
                  (config) => (config.template = e.currentTarget.value),
                )
              }
            ></input>
          </ListItem>
        </>
      )}
      <ListItem
        title={Locale.Settings.HistoryCount.Title}
        subTitle={Locale.Settings.HistoryCount.SubTitle}
      >
        <InputRange
          aria={Locale.Settings.HistoryCount.Title}
          title={props.modelConfig.historyMessageCount.toString()}
          value={props.modelConfig.historyMessageCount}
          min="0"
          max="64"
          step="1"
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.historyMessageCount = e.target.valueAsNumber),
            )
          }
        ></InputRange>
      </ListItem>

      <ListItem
        title={Locale.Settings.CompressThreshold.Title}
        subTitle={Locale.Settings.CompressThreshold.SubTitle}
      >
        <input
          aria-label={Locale.Settings.CompressThreshold.Title}
          type="number"
          min={500}
          max={4000}
          value={props.modelConfig.compressMessageLengthThreshold}
          onChange={(e) =>
            props.updateConfig(
              (config) =>
                (config.compressMessageLengthThreshold =
                  e.currentTarget.valueAsNumber),
            )
          }
        ></input>
      </ListItem>
      <ListItem title={Locale.Memory.Title} subTitle={Locale.Memory.Send}>
        <input
          aria-label={Locale.Memory.Title}
          type="checkbox"
          checked={props.modelConfig.sendMemory}
          onChange={(e) =>
            props.updateConfig(
              (config) => (config.sendMemory = e.currentTarget.checked),
            )
          }
        ></input>
      </ListItem>
      <ListItem title={Locale.Settings.CompressProvider.Title}>
        <Select
          aria-label={Locale.Settings.CompressProvider.Title}
          value={
            props.modelConfig.compressProviderName || ServiceProvider.OpenAI
          }
          align="center"
          onChange={(e) => {
            const provider = e.currentTarget.value as ServiceProvider;
            props.updateConfig((config) => {
              config.compressProviderName = provider;
              // 如果选择了新的提供商，自动选择该提供商的第一个可用模型
              if (provider) {
                const firstModelForProvider = allModels.find(
                  (m) => m.available && m.provider?.providerName === provider,
                );
                if (firstModelForProvider) {
                  config.compressModel = ModalConfigValidator.model(
                    firstModelForProvider.name,
                  );
                }
              }
            });
          }}
        >
          {validProviders.map(([k, v]) => (
            <option value={v} key={k}>
              {k}
            </option>
          ))}
        </Select>
      </ListItem>
      <ListItem
        title={Locale.Settings.CompressModel.Title}
        subTitle={Locale.Settings.CompressModel.SubTitle}
      >
        <Select
          aria-label={Locale.Settings.CompressModel.Title}
          value={compressModelValue}
          align="center"
          onChange={(e) => {
            const [model, providerName] = getModelProvider(
              e.currentTarget.value,
            );
            props.updateConfig((config) => {
              config.compressModel = ModalConfigValidator.model(model);
              config.compressProviderName = providerName as ServiceProvider;
            });
          }}
        >
          {allModels
            .filter(
              (v) =>
                v.available &&
                (!props.modelConfig.compressProviderName ||
                  v.provider?.providerName ===
                    props.modelConfig.compressProviderName),
            )
            .map((v, i) => (
              <option value={`${v.name}@${v.provider?.providerName}`} key={i}>
                {v.displayName}
                {!props.modelConfig.compressProviderName
                  ? `(${v.provider?.providerName})`
                  : ""}
              </option>
            ))}
        </Select>
      </ListItem>
    </>
  );
}
