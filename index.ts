import * as pulumi from "@pulumi/pulumi";
import * as aks from "./aks";
import * as eks from "./eks";

const projectName = pulumi.getProject();

// Create Kubernetes clusters.
const aksCluster = new aks.AksCluster(`${projectName}`);
const eksCluster = new eks.EksCluster(`${projectName}`);

// Export AKS static IP and both kubeconfigs.
export const aksStaticAppIp = aksCluster.staticAppIp;
export const aksKubeconfig = aksCluster.kubeconfig;
export const eksKubeconfig = eksCluster.kubeconfig;
