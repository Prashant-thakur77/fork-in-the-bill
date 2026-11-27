# References

Sources for the methods used in this experiment, grouped by topic. Each entry was checked against its abstract page, DOI record, publisher page or official documentation on 2026-11-27. The note under each entry says which part of the project it relates to.

## 1. LLM cost/quality routing and cascades

- Chen, L., Zaharia, M., & Zou, J. (2023). FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance. arXiv:2305.05176; accepted by Transactions on Machine Learning Research. https://arxiv.org/abs/2305.05176
  - Describes LLM cascades that send queries to cheaper models first; relates to the hypothesis that moving the delegate lane to a small model lowers cost per task.
- Ong, I., Almahairi, A., Wu, V., Chiang, W.-L., Wu, T., Gonzalez, J. E., Kadous, M. W., & Stoica, I. (2024). RouteLLM: Learning to Route LLMs with Preference Data. arXiv:2406.18665; ICLR 2025 (poster). https://arxiv.org/abs/2406.18665
  - Studies routing between a strong and a weak model to trade cost against quality; relates to the two arms, which fix the delegate lane to the frontier model or to the small model.
- Aggarwal, P., Madaan, A., Anand, A., et al. (2023). AutoMix: Automatically Mixing Language Models. arXiv:2310.12963; NeurIPS 2024. https://arxiv.org/abs/2310.12963
  - Routes queries from a smaller to a larger model based on a self-check of the smaller model's answer; relates to the cost-versus-solve-rate trade-off the experiment measures.
- Ding, D., Mallick, A., Wang, C., Sim, R., Mukherjee, S., Ruhle, V., Lakshmanan, L. V. S., & Awadallah, A. H. (2024). Hybrid LLM: Cost-Efficient and Quality-Aware Query Routing. arXiv:2404.14618; ICLR 2024. https://arxiv.org/abs/2404.14618
  - Routes each query to a small or a large model according to predicted difficulty and a quality target; relates to the choice of model for the delegate lane.

## 2. Software-engineering agent benchmarks, contamination and cost reporting

- Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2023). SWE-bench: Can Language Models Resolve Real-World GitHub Issues? arXiv:2310.06770; ICLR 2024. https://arxiv.org/abs/2310.06770
  - Defines the task format (a real GitHub issue, graded by the repository's tests) behind the `task_solved` outcome.
- Zhang, L., He, S., Zhang, C., et al. (2025). SWE-bench Goes Live! arXiv:2505.23419; NeurIPS 2025 Datasets and Benchmarks Track. https://arxiv.org/abs/2505.23419
  - Describes SWE-bench-Live, the continuously updated benchmark family the experiment's tasks come from.
- Li, K., Li, R., Zhang, L., et al. (2026). RepoLaunch: Automating Build and Management of Code Repositories across Languages and Platforms. arXiv:2603.05026 (arXiv comment: NeurIPS 2026 main track, poster). https://arxiv.org/abs/2603.05026
  - The reference the SWE-bench-Live site gives for the MultiLang set, which is the task pool used here.
- Liang, S., Garg, S., & Moghaddam, R. Z. (2025). The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason. arXiv:2506.12286. https://arxiv.org/abs/2506.12286
  - Reports evidence that models memorise SWE-bench tasks; relates to the use of a regularly refreshed task source.
- Kapoor, S., Stroebl, B., Siegel, Z. S., Nadgir, N., & Narayanan, A. (2024). AI Agents That Matter. arXiv:2407.01502; accepted by Transactions on Machine Learning Research. https://arxiv.org/abs/2407.01502
  - Argues that agent evaluations should report cost alongside accuracy; relates to the primary outcome, dollars per solved task.

## 3. Agent architectures that split planning from execution

- Xu, B., Peng, Z., Lei, B., Mukherjee, S., Liu, Y., & Xu, D. (2023). ReWOO: Decoupling Reasoning from Observations for Efficient Augmented Language Models. arXiv:2305.18323. https://arxiv.org/abs/2305.18323
  - Detaches the model's planning from tool execution and observations, with a planner handing steps to workers; relates to the agent's split between the planner (main lane) and the worker (delegate lane).
- Anthropic (2024). Building effective agents. Anthropic Engineering, published 19 December 2024. https://www.anthropic.com/research/building-effective-agents
  - Describes the orchestrator-workers workflow, in which a central LLM delegates subtasks to worker LLMs; relates to the lane structure of the agent under test.

## 4. Online controlled experiments

- Kohavi, R., Tang, D., & Xu, Y. (2020). Trustworthy Online Controlled Experiments: A Practical Guide to A/B Testing. Cambridge University Press. https://doi.org/10.1017/9781108653985
  - General reference for the experiment design: randomisation unit, guardrail metrics, sample ratio mismatch and checks on whether a result can be trusted.
- Fabijan, A., Gupchup, J., Gupta, S., Omhover, J., Qin, W., Vermeer, L., & Dmitriev, P. (2019). Diagnosing Sample Ratio Mismatch in Online Controlled Experiments: A Taxonomy and Rules of Thumb for Practitioners. Proceedings of the 25th ACM SIGKDD International Conference on Knowledge Discovery & Data Mining (KDD '19), 2156-2164. https://doi.org/10.1145/3292500.3330722
  - Relates to the sample-ratio check (chi-square test on the arm counts) reported with the results.
- Johari, R., Koomen, P., Pekelis, L., & Walsh, D. (2017). Peeking at A/B Tests: Why it matters, and what to do about it. Proceedings of the 23rd ACM SIGKDD International Conference on Knowledge Discovery and Data Mining (KDD '17), 1517-1525. https://doi.org/10.1145/3097983.3097992
  - Shows how continuous monitoring of a running test invalidates fixed-horizon inference; relates to the pre-registered rule of no early stopping.

## 5. Variance reduction with pre-experiment covariates

- Deng, A., Xu, Y., Kohavi, R., & Walker, T. (2013). Improving the Sensitivity of Online Controlled Experiments by Utilizing Pre-Experiment Data. Proceedings of the Sixth ACM International Conference on Web Search and Data Mining (WSDM 2013), 123-132. https://doi.org/10.1145/2433396.2433413
  - Source of CUPED, the covariate adjustment used in the secondary analysis.

## 6. Pre-registration and the garden of forking paths

- Nosek, B. A., Ebersole, C. R., DeHaven, A. C., & Mellor, D. T. (2018). The preregistration revolution. Proceedings of the National Academy of Sciences, 115(11), 2600-2606. https://doi.org/10.1073/pnas.1708274114
  - Relates to registering the hypothesis, metrics and decision rule, and publishing their hash, before the first task ran.
- Gelman, A., & Loken, E. (2013). The garden of forking paths: Why multiple comparisons can be a problem, even when there is no "fishing expedition" or "p-hacking" and the research hypothesis was posited ahead of time. Unpublished manuscript, dated 14 November 2013. https://sites.stat.columbia.edu/gelman/research/unpublished/p_hacking.pdf
  - Describes how analysis choices made after seeing the data act as researcher degrees of freedom; relates to fixing the analysis plan and exclusion rules in advance.

## 7. Non-inferiority margins and Bayesian decision rules

- U.S. Food and Drug Administration (2016). Non-Inferiority Clinical Trials to Establish Effectiveness: Guidance for Industry. Center for Drug Evaluation and Research and Center for Biologics Evaluation and Research, November 2016. https://www.fda.gov/regulatory-information/search-fda-guidance-documents/non-inferiority-clinical-trials
  - Relates to the solve-rate guardrail, which is a non-inferiority test against a margin fixed before the experiment.
- Gelman, A., Carlin, J. B., Stern, H. S., Dunson, D. B., Vehtari, A., & Rubin, D. B. (2013). Bayesian Data Analysis (3rd ed.). Chapman & Hall/CRC. https://doi.org/10.1201/b16018
  - Textbook treatment of the Beta prior with binomial data; relates to the Beta(1,1) posterior on each arm's solve rate and the posterior probability used in the decision rule.
- Deng, A., Lu, J., & Chen, S. (2016). Continuous Monitoring of A/B Tests without Pain: Optional Stopping in Bayesian Testing. arXiv:1602.05549. https://arxiv.org/abs/1602.05549
  - Discusses Bayesian inference for A/B tests and its behaviour under optional stopping; relates to stating the verdict as a posterior probability.

## 8. Bootstrap confidence intervals

- Efron, B., & Tibshirani, R. J. (1994). An Introduction to the Bootstrap. Chapman & Hall. https://www.routledge.com/An-Introduction-to-the-Bootstrap/Efron-Tibshirani/p/book/9780412042317
  - Relates to the percentile bootstrap intervals reported for mean cost, cost per solved task and their differences between arms.

## 9. Tamper-evident logs

- Merkle, R. C. (1988). A Digital Signature Based on a Conventional Encryption Function. Advances in Cryptology - CRYPTO '87, Lecture Notes in Computer Science, 369-378. Springer. https://doi.org/10.1007/3-540-48184-2_32
  - The paper commonly cited for hash trees (Merkle trees); relates to the Merkle root computed over the run's `task_done` records.
- Haber, S., & Stornetta, W. S. (1991). How to time-stamp a digital document. Journal of Cryptology, 3(2), 99-111. https://doi.org/10.1007/BF00196791
  - Describes linking each record to the hash of the one before it; relates to the hash-chained run ledger.
- Crosby, S. A., & Wallach, D. S. (2009). Efficient Data Structures for Tamper-Evident Logging. 18th USENIX Security Symposium (USENIX Security 09). https://www.usenix.org/conference/usenixsecurity09/technical-sessions/presentation/efficient-data-structures-tamper-evident
  - Covers hash-chain and tree-based logs that an auditor can check; relates to the ledger verification script.
- Laurie, B., Langley, A., & Kasper, E. (2013). Certificate Transparency. RFC 6962 (Experimental), IETF; obsoleted by RFC 9162. https://www.rfc-editor.org/info/rfc6962
  - Specifies an append-only public log built on a Merkle tree; relates to publishing a root hash that others can recompute.

## 10. Feature flags as an experimentation mechanism

- Tang, D., Agarwal, A., O'Brien, D., & Meyer, M. (2010). Overlapping Experiment Infrastructure: More, Better, Faster Experimentation. Proceedings of the 16th ACM SIGKDD International Conference on Knowledge Discovery and Data Mining (KDD '10), 17-26. https://doi.org/10.1145/1835804.1835810
  - Describes Google's infrastructure and processes for running many experiments on a live system; relates to using the flag platform as the assignment mechanism for the two arms.
- Flagsmith (n.d.). Experimentation (Beta). Flagsmith Docs, accessed 27 November 2026. https://docs.flagsmith.com/experimentation
  - Documentation for the platform feature the experiment runs on: a multivariate flag, exposure and conversion events, and a Bayesian results engine.
- Flagsmith (n.d.). Rollout by Percentage. Flagsmith Docs, accessed 27 November 2026. https://docs.flagsmith.com/managing-flags/rollout/rollout-by-percentage
  - Describes how an identity is hashed to a value between 0 and 1 and compared with a percentage split; relates to the offline re-derivation of each task's arm (the per-identity behaviour of multivariate flags is described at https://docs.flagsmith.com/managing-flags/core-management).
