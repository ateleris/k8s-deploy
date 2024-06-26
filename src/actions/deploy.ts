import * as core from '@actions/core'
import * as models from '../types/kubernetesTypes'
import * as KubernetesConstants from '../types/kubernetesTypes'
import {Kubectl, Resource} from '../types/kubectl'
import {
   getResources,
   updateManifestFiles
} from '../utilities/manifestUpdateUtils'
import {
   annotateAndLabelResources,
   checkManifestStability,
   deployManifests
} from '../strategyHelpers/deploymentHelper'
import {DeploymentStrategy} from '../types/deploymentStrategy'
import {parseTrafficSplitMethod} from '../types/trafficSplitMethod'
import fs from 'fs-extra'

export async function deploy(
   kubectl: Kubectl,
   manifestFilePaths: string[],
   deploymentStrategy: DeploymentStrategy
) {
   // update manifests
   const inputManifestFiles: string[] = updateManifestFiles(manifestFilePaths)
   core.debug(`Input manifest files: ${inputManifestFiles}`)

   // replace image tags
   const imageToReplace = core.getInput('imageToReplace')
   const targetImage = core.getInput('targetImage')
   core.startGroup('Replacing image tags')
   inputManifestFiles.forEach(async (file) => {
      core.debug(`Processing file: ${file}`)
      const fileContent = await fs.readFile(file, 'utf8')
      const updatedContent = fileContent.replace(imageToReplace, targetImage)
      fs.writeFile(file, updatedContent, {encoding: 'utf8'})
   })

   // deploy manifests
   core.startGroup('Deploying manifests')
   const trafficSplitMethod = parseTrafficSplitMethod(
      core.getInput('traffic-split-method', {required: true})
   )
   const deployedManifestFiles = await deployManifests(
      inputManifestFiles,
      deploymentStrategy,
      kubectl,
      trafficSplitMethod
   )
   core.debug(`Deployed manifest files: ${deployedManifestFiles}`)
   core.endGroup()

   // check manifest stability
   core.startGroup('Checking manifest stability')
   const resourceTypes: Resource[] = getResources(
      deployedManifestFiles,
      models.DEPLOYMENT_TYPES.concat([
         KubernetesConstants.DiscoveryAndLoadBalancerResource.SERVICE
      ])
   )
   await checkManifestStability(kubectl, resourceTypes)
   core.endGroup()

   // print ingresses
   core.startGroup('Printing ingresses')
   const ingressResources: Resource[] = getResources(deployedManifestFiles, [
      KubernetesConstants.DiscoveryAndLoadBalancerResource.INGRESS
   ])
   for (const ingressResource of ingressResources) {
      await kubectl.getResource(
         KubernetesConstants.DiscoveryAndLoadBalancerResource.INGRESS,
         ingressResource.name,
         false,
         ingressResource.namespace
      )
   }
   core.endGroup()

   // annotate resources
   core.startGroup('Annotating resources')
   await annotateAndLabelResources(
      deployedManifestFiles,
      kubectl,
      resourceTypes
   )
   core.endGroup()
}
