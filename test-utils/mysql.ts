import { AuthorizationModel } from "../src/models/authorization.model";
import { ProductModel } from "../src/models/product.model";
import { UserModel } from "../src/models/user.model";

export async function cleanAllTables(tx?: any) {
  await AuthorizationModel.destroy({ where: {}, transaction: tx }); // child
  await UserModel.destroy({ where: {}, transaction: tx }); // parent
}