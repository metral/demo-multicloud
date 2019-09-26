import * as azure from "@pulumi/azure";
import * as azuread from "@pulumi/azuread";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";

export class AksCluster extends pulumi.ComponentResource {
    public cluster: azure.containerservice.KubernetesCluster;
    public provider: k8s.Provider;
    public staticAppIp: pulumi.Output<string>;
    public kubeconfig: pulumi.Output<any>;

    constructor(name: string,
                opts: pulumi.ComponentResourceOptions = {}) {
        super("examples:kubernetes-ts-multicloud:AksCluster", name, {}, opts);

        // Generate a strong password for the Service Principal.
        const password = new random.RandomString(`${name}-password`, {
            length: 20,
            special: true,
        }, {parent: this, additionalSecretOutputs: ["result"]}).result;

        // Create an SSH public key that will be used by the Kubernetes cluster.
        // Note: We create one here to simplify the demo, but a production
        // deployment would probably pass an existing key in as a variable.
        const sshPublicKey = new tls.PrivateKey(`${name}-sshKey`, {
            algorithm: "RSA",
            rsaBits: 4096,
        }, {parent: this}).publicKeyOpenssh;

        // Create the AD service principal for the K8s cluster.
        const adApp = new azuread.Application(`${name}-aks`, undefined, {parent: this});
        const adSp = new azuread.ServicePrincipal(`${name}-aksSp`, {
            applicationId: adApp.applicationId
        }, {parent: this});
        const adSpPassword = new azuread.ServicePrincipalPassword(`${name}-aksSpPassword`, {
            servicePrincipalId: adSp.id,
            value: password,
            endDate: "2020-01-01T00:00:00Z",
        }, {parent: this});

        const resourceGroup = new azure.core.ResourceGroup(`${name}`);

        // Grant the resource group the "Network Contributor" role so that it
        // can link the static IP to a Service LoadBalancer.
        const rgNetworkRole = new azure.role.Assignment(`${name}-spRole`, {
            principalId: adSp.id,
            scope: resourceGroup.id,
            roleDefinitionName: "Network Contributor"
        }, {parent: this});

        // Create a Virtual Network for the cluster
        const vnet = new azure.network.VirtualNetwork(`${name}`, {
            resourceGroupName: resourceGroup.name,
            addressSpaces: ["10.2.0.0/16"],
        }, {parent: this});

        // Create a Subnet for the cluster
        const subnet = new azure.network.Subnet(`${name}`, {
            resourceGroupName: resourceGroup.name,
            virtualNetworkName: vnet.name,
            addressPrefix: "10.2.1.0/24",
        }, {parent: this});

        // Create the AKS cluster.
        this.cluster = new azure.containerservice.KubernetesCluster(`${name}`, {
            resourceGroupName: resourceGroup.name,
            agentPoolProfiles: [{
                name: "aksagentpool",
                count: 2,
                vmSize: "Standard_B2s",
                osType: "Linux",
                osDiskSizeGb: 30,
                vnetSubnetId: subnet.id,
            }],
            dnsPrefix: name,
            linuxProfile: {
                adminUsername: "aksuser",
                sshKey: {
                    keyData: sshPublicKey,
                },
            },
            servicePrincipal: {
                clientId: adApp.applicationId,
                clientSecret: adSpPassword.value,
            },
            kubernetesVersion: "1.14.6",
            roleBasedAccessControl: {enabled: true},
            networkProfile: {
                networkPlugin: "azure",
                dnsServiceIp: "10.2.2.254",
                serviceCidr: "10.2.2.0/24",
                dockerBridgeCidr: "172.17.0.1/16",
            },
        }, {parent: this});

        // Expose a k8s provider instance of the cluster.
        this.provider = new k8s.Provider(`${name}-aks`, {
            kubeconfig: this.cluster.kubeConfigRaw,
        }, {parent: this});

        // Create a static public IP for the Service LoadBalancer.
        this.staticAppIp = new azure.network.PublicIp(`${name}-staticAppIp`, {
            resourceGroupName: this.cluster.nodeResourceGroup,
            allocationMethod: "Static"
        }, {parent: this}).ipAddress;

        // Export the kubeconfig.
        this.kubeconfig = this.cluster.kubeConfigRaw;
    }
}
